/**
 * narration_protocol —— 「:::指令行」叙事协议的解析器。
 *
 * 设计动机（替代旧的 JSON-in-prose 响应）：
 *   1. 文字到达即上屏：叙事 / 对白正文是裸文本，不再包在 JSON 字符串里，
 *      流式时残行可以直接显示，不必等一个 JSON 对象闭合。
 *   2. 坏一行只丢一行：每条指令独占一行、互不嵌套，模型写错某行时只损失
 *      那一行，其余仍能正常解析（未知指令整行忽略，向前兼容）。
 *   3. 省转义 token：正文不必转义引号 / 换行，模型产出更短更稳。
 *
 * 文法（权威来源是 src/lib/prompts/dialogue-runtime.ts 的「## 交互格式要求」段，
 * 本解析器必须与其逐字互恰）：
 *   :::narration              开启叙事段，正文随后多行；可多次出现，按序拼接
 *   :::say 角色名             开启对白段，角色名 = 该行 ":::say" 之后全部文本 trim
 *   :::choice 选项文本        单行：普通选项
 *   :::choice! 选项文本       单行：分支点选项（isBranchPoint=true）
 *   :::interact 角色名 | positive|neutral|negative | 事件简述 | 角色对玩家的反应
 *   :::end                    可选终止符
 *
 * 解析规则见各函数注释；本文件为纯函数实现，无浏览器 API 依赖，可在 node 下自测。
 */

import { stripThinking, type StreamingState, type StreamingDialogue } from '../llm-text';

export interface ProtocolChoice {
  text: string;
  isBranchPoint: boolean;
}

export interface ProtocolInteraction {
  characterName: string;
  event: string;
  reaction: string;
  sentiment: string;
}

/**
 * 文档序的内容块。协议允许 :::narration 与 :::say 任意交错（对白后的旁白、
 * 转场），这里保留原始顺序——消费方（assembleNarration）按 blocks 顺序生成
 * 条目，避免「所有叙事被合并置顶、时序错乱」。
 */
export type ProtocolBlock =
  | { type: 'narration'; content: string }
  | { type: 'dialogue'; speaker: string; content: string };

export interface ProtocolFinal {
  /** 全部叙事段合并（向后兼容字段；时序敏感的消费方请用 blocks）。 */
  narration: string;
  dialogues: { speaker: string; content: string }[];
  choices: ProtocolChoice[];
  interactions: ProtocolInteraction[];
  /** narration / dialogue 按文档出现顺序排列。 */
  blocks: ProtocolBlock[];
}

/** sentiment 只允许这三个值，其余（含缺省 / 非法）归一为 neutral。 */
const SENTIMENTS = new Set(['positive', 'neutral', 'negative']);
function normalizeSentiment(raw: string | undefined): string {
  const s = (raw ?? '').trim().toLowerCase();
  return SENTIMENTS.has(s) ? s : 'neutral';
}

/**
 * 探测：cleaned 中任意一行（去前导空白后）以 :::narration 或 :::say 开头即视为协议响应，
 * 命中则走协议解析，否则回退 legacy JSON 三级救援。\b 保证 ":::sayfoo" 不误判。
 *
 * 先看首个非空白字符做形状裁决：以 { / [ / ``` 开头的响应是 JSON 形（协议文档
 * 永远以 :::指令或裸正文开头）——JSON 字符串值里若恰好含行首 ":::narration"，
 * 不裁决会把整份 JSON 误路由到协议解析、结构全毁。
 */
export function isProtocolResponse(cleaned: string): boolean {
  const head = cleaned.trimStart();
  if (head.startsWith('{') || head.startsWith('[') || head.startsWith('```')) return false;
  return /^\s*:::(narration|say)\b/im.test(cleaned);
}

type Directive =
  | { kind: 'narration' }
  | { kind: 'say'; speaker: string }
  | { kind: 'choice'; text: string; bang: boolean }
  | { kind: 'interact'; rest: string }
  | { kind: 'end' }
  | { kind: 'unknown' };

/**
 * 把一条已确认是指令行（trim 后以 ":::" 开头）的文本解析为 Directive。
 * 指令名取 ::: 之后第一个 token，大小写不敏感；choice! 的 ! 紧贴指令名。
 */
function parseDirectiveLine(trimmed: string): Directive {
  const body = trimmed.slice(3); // 去掉 ":::"
  const m = body.match(/^([a-zA-Z]+)(!?)/);
  if (!m) return { kind: 'unknown' };
  const name = m[1].toLowerCase();
  const bang = m[2] === '!';
  // token 之后的余下文本（去掉名字 + 可能的 ! 之后，再去首部一个空白）
  const rest = body.slice(m[0].length).replace(/^[ \t]/, '');
  switch (name) {
    case 'narration':
      return { kind: 'narration' };
    case 'say':
      return { kind: 'say', speaker: rest.trim() };
    case 'choice':
      return { kind: 'choice', text: rest.trim(), bang };
    case 'interact':
      return { kind: 'interact', rest };
    case 'end':
      return { kind: 'end' };
    default:
      return { kind: 'unknown' };
  }
}

function parseInteract(rest: string): ProtocolInteraction {
  // 字段：角色名 | sentiment | 事件简述 | 反应；缺省字段补空，sentiment 归一。
  const parts = rest.split('|').map(p => p.trim());
  return {
    characterName: parts[0] ?? '',
    sentiment: normalizeSentiment(parts[1]),
    event: parts[2] ?? '',
    reaction: parts[3] ?? '',
  };
}

/** scan 的内部块：与 ProtocolBlock 同构，但对白可带流式 partial 标记。 */
type ScanBlock =
  | { kind: 'narration'; content: string }
  | { kind: 'say'; speaker: string; content: string; partial?: boolean };

interface ScanResult {
  /** 按文档出现顺序的内容块（叙事段与对白交错保序）。 */
  blocks: ScanBlock[];
  choices: ProtocolChoice[];
  interactions: ProtocolInteraction[];
}

/**
 * 单趟逐行扫描的共享实现（流式与终态共用，避免两份逻辑漂移）。
 *
 * @param streaming 流式模式：处理最后一行（buffer 末尾无换行）时按规范第 5 条——
 *   若末行不是完整行（buffer 不以换行结尾）且看起来可能正在形成一条指令
 *   （trim 后以 ":" 开头），则暂扣该残行不并入正文；否则残行作为当前开启段正文上屏，
 *   并将最后一个仍开启的对白标 partial。终态模式（false）不做暂扣，全部并入。
 */
function scan(buffer: string, streaming: boolean): ScanResult {
  const blocks: ScanBlock[] = [];
  const choices: ProtocolChoice[] = [];
  const interactions: ProtocolInteraction[] = [];

  // 当前开启的内容块（narration / say）；null = 无开启段。
  let open: ScanBlock | null = null;

  const appendBody = (block: ScanBlock, line: string) => {
    block.content = block.content === '' ? line : block.content + '\n' + line;
  };
  const openNarration = () => {
    open = { kind: 'narration', content: '' };
    blocks.push(open);
  };

  // 末行是否为不完整残行：仅流式且 buffer 不以换行结尾时，最后一段才算残行。
  const endsWithNewline = /\n$/.test(buffer);
  const lines = buffer.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const isPartialLine = streaming && isLast && !endsWithNewline;
    const trimmed = line.trim();

    if (trimmed.startsWith(':::')) {
      // 流式残行若正在形成指令（以 ":" 开头但还没凑齐 ":::…"），暂扣不显示。
      // 此处 trimmed 已是 ":::" 开头：若是残行，仍可能是半截指令（如 ":::sa"），暂扣。
      if (isPartialLine) continue;

      const d = parseDirectiveLine(trimmed);
      if (d.kind === 'unknown') {
        // 未知 ::: 行：有开启段时按正文保留（对白/旁白里引用类似语法的内容
        // 不该被吞掉）；无开启段时整行忽略（向前兼容）。
        if (open) appendBody(open, line);
        continue;
      }
      switch (d.kind) {
        case 'narration':
          openNarration();
          break;
        case 'say':
          open = { kind: 'say', speaker: d.speaker, content: '' };
          blocks.push(open);
          break;
        case 'choice':
          choices.push({ text: d.text, isBranchPoint: d.bang });
          break;
        case 'interact':
          interactions.push(parseInteract(d.rest));
          break;
        case 'end':
          // 终止符：关闭当前段。
          open = null;
          break;
      }
      continue;
    }

    // —— 正文行 ——
    // 流式残行：若以 ":" 开头（可能正在形成指令），暂扣不显示（规范第 5 条）。
    if (isPartialLine && trimmed.startsWith(':')) continue;

    // 无开启段时（模型忘写头部）并入新开的 narration 容错。
    if (!open) openNarration();
    appendBody(open!, line);
  }

  // 流式：文档以仍开启的对白结尾 → 标 partial。
  if (streaming && open && open.kind === 'say') {
    open.partial = true;
  }

  return { blocks, choices, interactions };
}

/**
 * 流式增量解析：返回与 narrator-browser 一致的 StreamingState
 * （narration 字符串 + dialogues，含可能的 partial 尾对白）。
 * 多段 narration 以 \n 连接。
 */
export function extractProtocolStreamingState(buffer: string): StreamingState {
  const cleaned = stripThinking(buffer);
  const { blocks } = scan(cleaned, true);
  // StreamingState 形状限定为「单 narration + 对白列表」（与 legacy 一致），
  // 流式视图损失交错顺序可接受——最终落盘由 parseProtocolFinal 的 blocks 保序。
  // 流式不裁掉空对白（内容正在到达），但保留 partial 标记供上层处理。
  const narration = blocks
    .filter((b): b is Extract<ScanBlock, { kind: 'narration' }> => b.kind === 'narration')
    .map(b => b.content)
    .join('\n');
  const dialogues: StreamingDialogue[] = blocks
    .filter((b): b is Extract<ScanBlock, { kind: 'say' }> => b.kind === 'say')
    .map(b => ({ speaker: b.speaker, content: b.content, ...(b.partial ? { partial: true } : {}) }));
  return { narration, dialogues };
}

/**
 * 终态解析：取完整结果。空内容对白丢弃、narration trim、
 * interact 字段缺省容错、sentiment 归一 neutral。
 */
export function parseProtocolFinal(buffer: string): ProtocolFinal {
  const cleaned = stripThinking(buffer);
  const { blocks: scanned, choices, interactions } = scan(cleaned, false);
  // 终态：trim 并丢弃空块；blocks 保留文档序，narration/dialogues 为兼容投影。
  const blocks: ProtocolBlock[] = [];
  for (const b of scanned) {
    const content = b.content.trim();
    if (content === '') continue;
    blocks.push(b.kind === 'narration'
      ? { type: 'narration', content }
      : { type: 'dialogue', speaker: b.speaker, content });
  }
  return {
    narration: blocks
      .filter((b): b is Extract<ProtocolBlock, { type: 'narration' }> => b.type === 'narration')
      .map(b => b.content)
      .join('\n'),
    dialogues: blocks
      .filter((b): b is Extract<ProtocolBlock, { type: 'dialogue' }> => b.type === 'dialogue')
      .map(b => ({ speaker: b.speaker, content: b.content })),
    choices,
    interactions,
    blocks,
  };
}
