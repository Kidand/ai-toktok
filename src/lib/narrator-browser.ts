/** 浏览器端叙事生成 - 直接调用 LLM API */

import { callLLMBrowser, streamLLMBrowser } from './llm-browser';
import {
  LLMConfig, ParsedStory, PlayerConfig, GuardrailParams,
  NarrativeBalance, NarrativeEntry, StoryChoice,
} from './types';
import { v4 as uuid } from 'uuid';

function buildWorldSystemPrompt(
  story: ParsedStory,
  playerConfig: PlayerConfig,
  guardrail: GuardrailParams,
  balance: NarrativeBalance,
): string {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const entryEvent = story.keyEvents[playerConfig.entryEventIndex];
  const charDescriptions = story.characters
    .filter(c => c.id !== playerConfig.characterId)
    .map(c => `【${c.name}】${c.personality}。${c.background}`)
    .join('\n');
  const strictnessGuide = guardrail.strictness > 0.7
    ? '严格遵循原作设定，角色性格不易被改变，世界规则绝对不可违反。'
    : guardrail.strictness > 0.4
      ? '基本遵循原作设定，但允许合理的性格发展和意外反应。'
      : '角色有较大的行为弹性，可以做出更意外的反应，但核心设定仍需保持。';
  const narrativeGuide = balance.narrativeWeight > 60
    ? '以叙事为主，大段描写环境、心理和行为，对话穿插其中。'
    : balance.narrativeWeight > 30
      ? '叙事与对话交替，既有环境描写也有频繁的角色互动。'
      : '以对话为主，频繁与角色交流互动，简短的环境和动作描述穿插其中。';

  return `你是一个沉浸式互动叙事引擎。你正在运行一个基于以下故事世界的互动叙事体验。

## 故事世界
标题：${story.title}
${story.summary}

## 世界观设定
时代：${story.worldSetting.era}
类型：${story.worldSetting.genre}
叙事风格：${story.worldSetting.toneDescription}
世界规则：
${story.worldSetting.rules.map(r => `- ${r}`).join('\n')}

## 角色列表
${charDescriptions}

## 玩家角色
模式：${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}
角色：${playerChar?.name || '未知'}
身份：${playerChar?.description || ''}
性格：${playerChar?.personality || ''}
背景：${playerChar?.background || ''}

## 当前剧情节点
${entryEvent ? `从"${entryEvent.title}"开始：${entryEvent.description}` : '从故事开头开始'}

## 世界观护栏
${strictnessGuide}
- 如果玩家的行为完全超出世界观，通过合理的剧情方式化解
- 核心角色的基本设定不可被轻易改写
- 玩家的行为会有成功或失败的合理结果

## 叙事风格
${narrativeGuide}

## 剧情推进要求（必须遵守）
每次回复都要让故事实质前进，不能原地踏步。具体要求：
- 至少发生一件**具体的事**：角色采取行动、揭示新信息、环境/时间变化、人物关系变化、新角色登场或离场
- **禁止**只用不同措辞重复已有场景（例："他仍站在原地"、"店主又打量了他一眼"、"空气依然凝重"）
- **禁止**连续两次以纯观察/沉思/环境描写作为主要内容
- 当玩家的输入较被动（如"观察"、"等待"、"继续"、"思考一下"），**由你主动引入新事件或角色动作**推动剧情前进
- 当玩家的输入具体明确，立刻演出其后果与相关角色的直接反应
- 单次回复聚焦 1-2 个小事件，控制在 150-400 字；叙事描写占比 ≤ 50%，其余是对话、动作、事件发生
- 回复结尾要把场景推到一个新的节点（新地点/新人到场/新冲突升级/新信息揭示），不要停在"一切未定"的模糊状态

## 选项设计（choices）
- 必须是**具体行动**（做什么、说什么、去哪里），不是"感受什么"或"继续观察"
  - ✓ "上前询问店主关于昨夜的动静"
  - ✓ "拔剑逼问王公公"
  - ✗ "继续观察店主"
  - ✗ "思考下一步"
- 至少一个选项要能推动主线（揭示关键信息 / 引入冲突 / 遇见关键角色 / 进入关键地点）
- 避免"等等看"、"再观察"、"暂不行动"这类使剧情停滞的选项

## 交互格式要求
你的每次回复必须严格按照以下JSON格式返回，不要包含任何其他文字：

{
  "narration": "叙事内容",
  "dialogues": [{ "speaker": "角色名", "content": "对话内容" }],
  "choices": [
    { "text": "选项描述", "isBranchPoint": false }
  ],
  "interactions": [
    { "characterName": "角色名", "event": "互动事件", "reaction": "角色反应", "sentiment": "positive/neutral/negative" }
  ]
}

## 对白归属规则（非常重要）
- 任何角色说出口的话，**必须**放进 \`dialogues\` 数组，一条一个对象
- **禁止**把对白写进 \`narration\` 字段。以下几种写法一律禁止：
  - ✗ \`[弗兰克] 闭嘴，你这只死狗！\`
  - ✗ \`弗兰克："闭嘴，你这只死狗！"\`
  - ✗ \`弗兰克说：闭嘴。\`（连同角色名 + 冒号 + 台词的任何变体）
  - ✗ \`电话那头传来托德漫不经心的语调："哦？律师先生……"\`（藏在描写句里的直接引语也禁止）
  - ✗ \`他发出一声低沉的笑："你的小朋友惹麻烦了……"\`
- narration 字段**绝对不能出现任何中文/英文引号包起来的直接引语**——只要是角色嘴里说出来的原话，一律拆到 \`dialogues\` 里
- narration 字段只写：环境描写、角色动作、心理活动、第三人称叙事
- 每一条 \`dialogues\` 条目的 \`speaker\` 必须是上面"角色列表"中已出现的名字或玩家角色名；如果是神秘的未揭示者，用 "???" 作为 speaker 并在 narration 里描写其外形/声音
- \`dialogues\` 条目的 \`content\` 不能为空字符串——没话可说就不要出这个条目

注意：choices 提供 2-3 个选项（都要是具体行动）；interactions 记录本轮有反应的角色。`;
}

function buildHistoryContext(history: NarrativeEntry[], maxEntries = 20): string {
  return history.slice(-maxEntries).map(entry => {
    switch (entry.type) {
      case 'narration': return `[叙事] ${entry.content}`;
      case 'dialogue': return `[${entry.speaker}] ${entry.content}`;
      case 'player-action': return `[玩家行动] ${entry.content}`;
      default: return entry.content;
    }
  }).join('\n\n');
}

/**
 * Strip reasoning-model thinking prefixes from a response buffer.
 *
 * Reasoning-capable models served through OpenAI-compatible endpoints
 * (DeepSeek-R1, MiniMax-M2, some Qwen/GLM tunes) often mix their chain-of-
 * thought into the primary content stream, typically wrapped in
 * `<think>...</think>` or `<thinking>...</thinking>` tags. That scrambles
 * our JSON parsing.
 *
 * This helper removes:
 *   - any complete `<think>…</think>` / `<thinking>…</thinking>` blocks
 *   - any trailing unclosed `<think(...)` — mid-stream, thinking is still
 *     being written and nothing after it is the real answer yet, so drop
 *     from the opening tag onward
 *
 * Case-insensitive. Safe to call on a partial buffer (streaming) or on a
 * completed response.
 */
export function stripThinking(buffer: string): string {
  // Complete blocks — greedy removal
  let out = buffer.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
  // Unclosed trailing block — chop from the opener
  const open = out.match(/<think(?:ing)?\b[^>]*>/i);
  if (open && open.index !== undefined) out = out.slice(0, open.index);
  return out;
}

/**
 * Find the first balanced JSON value (object or array) inside a buffer,
 * ignoring any preamble / trailing prose. Returns null if no balanced value
 * is present yet. Handles string literals and escapes so braces inside
 * strings don't throw off the depth counter.
 */
export function extractFirstBalancedJSON(buffer: string): string | null {
  const openIdx = buffer.search(/[{[]/);
  if (openIdx < 0) return null;
  const open = buffer[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = openIdx; i < buffer.length; i++) {
    const c = buffer[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return buffer.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Decode a (possibly partial) JSON string literal's body — the text between
 * the opening and closing quotes, minus the quotes themselves. Stops at the
 * first unescaped `"` (considered the closing quote) or at buffer exhaustion.
 * Returns the decoded text and the index of the first unconsumed char.
 */
function decodePartialJSONString(buffer: string, start: number): { value: string; endIdx: number } {
  let out = '';
  let i = start;
  while (i < buffer.length) {
    const c = buffer[i];
    if (c === '\\') {
      const next = buffer[i + 1];
      if (next === undefined) break; // incomplete escape, wait for more
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else if (next === '/') out += '/';
      else if (next === 'b') out += '\b';
      else if (next === 'f') out += '\f';
      else if (next === 'u') {
        if (i + 5 >= buffer.length) break;
        const code = parseInt(buffer.substr(i + 2, 4), 16);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
        i += 6;
        continue;
      } else out += next;
      i += 2;
    } else if (c === '"') {
      return { value: out, endIdx: i };
    } else {
      out += c;
      i++;
    }
  }
  return { value: out, endIdx: i };
}

/**
 * Extract the narration field value from a (possibly incomplete) JSON buffer
 * for streaming display. Thinking-model preambles (`<think>…</think>`) are
 * stripped first so that the inner reasoning text never leaks into the UI.
 */
export function extractStreamingNarration(buffer: string): string {
  const cleaned = stripThinking(buffer);
  const keyMatch = cleaned.match(/"narration"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return '';
  return decodePartialJSONString(cleaned, keyMatch.index + keyMatch[0].length).value;
}

export type StreamingDialogue = { speaker: string; content: string; partial?: boolean };
export type StreamingState = {
  narration: string;
  dialogues: StreamingDialogue[];
};

/**
 * Scan a buffer position for a balanced JSON object `{...}`. Returns the
 * parsed object and the index just after `}` if complete, or null if the
 * object is not yet closed.
 */
function tryParseBalancedObject(buffer: string, start: number): { value: Record<string, unknown>; endIdx: number } | null {
  if (buffer[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < buffer.length; i++) {
    const c = buffer[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return { value: JSON.parse(buffer.slice(start, i + 1)), endIdx: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Pull speaker + content from an open (unclosed) dialogue object at
 * `objStart`. Returns null if neither field has started yet.
 */
function extractPartialDialogue(buffer: string, objStart: number): StreamingDialogue | null {
  const slice = buffer.slice(objStart);
  const speakerKey = slice.match(/"speaker"\s*:\s*"/);
  const contentKey = slice.match(/"content"\s*:\s*"/);
  const speaker = speakerKey && speakerKey.index !== undefined
    ? decodePartialJSONString(slice, speakerKey.index + speakerKey[0].length).value
    : '';
  const content = contentKey && contentKey.index !== undefined
    ? decodePartialJSONString(slice, contentKey.index + contentKey[0].length).value
    : '';
  if (!speaker && !content) return null;
  return { speaker, content, partial: true };
}

/**
 * Extract narration + all dialogues (completed + partial last) from a
 * streaming JSON buffer. Designed for incremental UI rendering.
 */
export function extractStreamingState(buffer: string): StreamingState {
  // Work on a thinking-stripped view so reasoning-model prose never leaks.
  const cleaned = stripThinking(buffer);
  const narration = (() => {
    const keyMatch = cleaned.match(/"narration"\s*:\s*"/);
    if (!keyMatch || keyMatch.index === undefined) return '';
    return decodePartialJSONString(cleaned, keyMatch.index + keyMatch[0].length).value;
  })();
  const dialogues: StreamingDialogue[] = [];

  const arrMatch = cleaned.match(/"dialogues"\s*:\s*\[/);
  if (!arrMatch || arrMatch.index === undefined) return { narration, dialogues };

  let i = arrMatch.index + arrMatch[0].length;
  while (i < cleaned.length) {
    while (i < cleaned.length && /[\s,]/.test(cleaned[i])) i++;
    if (i >= cleaned.length) break;
    if (cleaned[i] === ']') break;
    if (cleaned[i] !== '{') break;

    const complete = tryParseBalancedObject(cleaned, i);
    if (complete) {
      const val = complete.value as { speaker?: string; content?: string };
      if (val.speaker || val.content) {
        dialogues.push({ speaker: val.speaker || '', content: val.content || '' });
      }
      i = complete.endIdx;
    } else {
      // Partial trailing dialogue — show what we have and stop.
      const partial = extractPartialDialogue(cleaned, i);
      if (partial && (partial.content || partial.speaker)) dialogues.push(partial);
      break;
    }
  }
  return { narration, dialogues };
}

type ParsedNarrationShape = {
  narration?: string;
  dialogues?: { speaker: string; content: string }[];
  choices?: { text: string; isBranchPoint: boolean }[];
  interactions?: { characterName: string; event: string; reaction: string; sentiment: string }[];
};

// Paired quote marks that indicate direct speech in Chinese-first prose.
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['\u201C', '\u201D'], // " "
  ['\u300C', '\u300D'], // 「 」
  ['\u300E', '\u300F'], // 『 』
];

type QuotedSpan = { start: number; end: number; content: string };

/**
 * Collect every paired-quote span in `text`, plus alternating ASCII `"`
 * pairs that live on the same line. Overlaps are resolved by keeping the
 * earliest-starting span.
 */
function findQuotedSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let i = 0;
    while (i < text.length) {
      const o = text.indexOf(open, i);
      if (o < 0) break;
      const c = text.indexOf(close, o + 1);
      if (c < 0) break;
      spans.push({ start: o, end: c + 1, content: text.slice(o + 1, c) });
      i = c + 1;
    }
  }
  // ASCII straight quotes: pair alternately, same line only (avoids pairing
  // an opening quote on one line with a closing quote many lines later).
  const asciiIdx: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '"') asciiIdx.push(i);
  for (let k = 0; k + 1 < asciiIdx.length; k += 2) {
    const s = asciiIdx[k], e = asciiIdx[k + 1];
    if (text.slice(s, e + 1).includes('\n')) continue;
    spans.push({ start: s, end: e + 1, content: text.slice(s + 1, e) });
  }
  spans.sort((a, b) => a.start - b.start);
  const nonOverlap: QuotedSpan[] = [];
  for (const s of spans) {
    if (nonOverlap.length === 0 || s.start >= nonOverlap[nonOverlap.length - 1].end) {
      nonOverlap.push(s);
    }
  }
  return nonOverlap;
}

const CJK_CHAR = /[\u4e00-\u9fa5]/;
const DOT_CHAR = /[\u00B7\u30FB]/;

// Characters that commonly appear right before a proper noun but aren't part
// of the name itself (connectors, verbs, particles, pronouns, quantifiers).
// Used to bound a walk-back scan when extracting a novel `X·Y` name from
// running prose. Enumeration is deliberately conservative — mis-stops just
// produce a slightly longer name, while missing stops produce a clearly
// wrong name like "而是托德·马丁".
const NAME_STOP_CHARS = new Set([
  '是', '而', '见', '听', '有', '只', '在', '正', '刚', '对', '当', '给', '让',
  '他', '她', '它', '我', '你', '着', '地', '之', '也', '却', '就', '便',
  '的', '了', '个', '位', '名', '被', '使', '向', '朝', '从', '到', '为',
  '来', '去', '传', '发', '走', '响', '出', '问', '请', '叫', '喊', '说', '道',
  '唤', '带', '跟', '随', '并', '和', '与', '看', '找', '等', '想', '要', '做',
  '如', '且', '又', '但', '可', '不', '没', '已', '必', '会', '能', '将',
  '吧', '啊', '呀', '哇', '呢', '吗', '于', '以',
]);

/**
 * Scan a text ending at the colon for a `...X·Y...` name pattern. Returns
 * the best-guess full name or null if no middle-dot name is present. We
 * walk back up to 4 CJK chars (stopping at obvious non-name chars) and
 * forward 2 CJK chars — most Chinese given names are exactly 2 chars.
 */
function scanDotName(tail: string): string | null {
  for (let i = tail.length - 1; i >= 0; i--) {
    const ch = tail.charAt(i);
    if (!DOT_CHAR.test(ch)) continue;
    let back = '';
    for (let j = i - 1; j >= 0 && back.length < 4; j--) {
      const c = tail.charAt(j);
      if (!CJK_CHAR.test(c)) break;
      if (NAME_STOP_CHARS.has(c)) break;
      back = c + back;
    }
    let forward = '';
    for (let j = i + 1; j < tail.length && forward.length < 2; j++) {
      const c = tail.charAt(j);
      if (!CJK_CHAR.test(c)) break;
      forward += c;
    }
    if (back.length >= 2 && forward.length >= 1) {
      return `${back}${ch}${forward}`;
    }
    // Keep scanning further left for another `·` if this one didn't yield
    // a usable name.
  }
  return null;
}

/**
 * Attribute a quoted span to a speaker using the narration that immediately
 * precedes it. Strategy, in confidence order:
 *   1. Full roster name present in the last 80 chars → latest occurrence.
 *   2. Novel `X·Y` name pattern in the same window (covers characters the
 *      model introduces that aren't in the roster, like "托德·马丁").
 *   3. Roster short-form match ("杰西" when roster has "杰西·平克曼") → full name.
 *
 * Returns null when no confident attribution is available; caller falls
 * back to running speaker or `???` depending on other signals.
 */
function attributeSpeakerFromBefore(before: string, speakerSet: Set<string>): string | null {
  const tail = before.slice(-80);

  let best: { name: string; idx: number } | null = null;
  for (const name of speakerSet) {
    if (!name) continue;
    const idx = tail.lastIndexOf(name);
    if (idx >= 0 && (!best || idx > best.idx)) best = { name, idx };
  }
  if (best) return best.name;

  const dotName = scanDotName(tail);
  if (dotName) return dotName;

  let shortBest: { full: string; idx: number } | null = null;
  for (const full of speakerSet) {
    if (!full) continue;
    const dotIdx = full.search(DOT_CHAR);
    const short = dotIdx >= 0 ? full.slice(0, dotIdx) : full.length >= 3 ? full.slice(0, 2) : '';
    if (short.length < 2) continue;
    const idx = tail.lastIndexOf(short);
    if (idx >= 0 && (!shortBest || idx > shortBest.idx)) shortBest = { full, idx };
  }
  if (shortBest) return shortBest.full;

  return null;
}

/**
 * If the LLM called the same character by both a full name and a short
 * form ("托德" vs. "托德·马丁"), promote the short form to the longer
 * previously-seen spelling so the UI shows a single consistent speaker.
 */
function canonicalizeSpeaker(name: string, seen: Set<string>): string {
  let best = name;
  for (const s of seen) {
    if (s.length > best.length && (s.startsWith(name) || s.endsWith(name))) best = s;
  }
  return best;
}

/**
 * Models sometimes collapse dialogue lines into the narration field. They
 * do it in script-style shorthand on its own line — "[弗兰克] 闭嘴！",
 * "弗兰克："闭嘴！"" — and also mid-paragraph, embedding quoted speech in
 * running prose ("托德·马丁漫不经心的语调："哦？律师先生……""). Both
 * cases get rescued here as real dialogue entries, positional order
 * preserved so narration and dialogue interleave the way the model meant.
 *
 * Known speakers (roster + player) are used as an allow-list for looser
 * line-level patterns so regular prose ("她走到窗边：外面……") doesn't get
 * accidentally mis-identified.
 */
function rescueEntriesFromNarration(
  narration: string,
  knownSpeakers: string[],
): NarrativeEntry[] {
  const speakerSet = new Set(knownSpeakers.filter(Boolean));
  const spans = findQuotedSpans(narration);

  type Chunk = { kind: 'narr'; text: string } | { kind: 'dialogue'; text: string; speaker: string };
  const chunks: Chunk[] = [];
  const seenSpeakers = new Set<string>(speakerSet);
  let cursor = 0;
  let runningSpeaker: string | null = null;

  for (const span of spans) {
    const rawBefore = narration.slice(cursor, span.start);
    const content = span.content.trim();
    const endsWithColon = /[\uff1a:]\s*$/.test(rawBefore);

    let speaker = attributeSpeakerFromBefore(rawBefore, speakerSet);
    if (!speaker && endsWithColon) speaker = runningSpeaker;

    // No attribution signal at all → leave the quote in narration. Could be
    // a title, nickname, or emphasized phrase rather than spoken dialogue.
    if (!speaker && !endsWithColon) {
      chunks.push({ kind: 'narr', text: narration.slice(cursor, span.end) });
      cursor = span.end;
      continue;
    }
    if (!content) {
      chunks.push({ kind: 'narr', text: narration.slice(cursor, span.end) });
      cursor = span.end;
      continue;
    }
    if (!speaker) speaker = '???';

    speaker = canonicalizeSpeaker(speaker, seenSpeakers);
    seenSpeakers.add(speaker);

    // Drop the trailing `：` that introduced the quote so the narration
    // chunk doesn't end on a dangling colon.
    const cleanBefore = rawBefore.replace(/\s*[\uff1a:]\s*$/, '');
    if (cleanBefore) chunks.push({ kind: 'narr', text: cleanBefore });
    chunks.push({ kind: 'dialogue', text: content, speaker });
    runningSpeaker = speaker;
    cursor = span.end;
  }
  chunks.push({ kind: 'narr', text: narration.slice(cursor) });

  const entries: NarrativeEntry[] = [];
  let narrBuf = '';
  const flushNarr = () => {
    if (!narrBuf) return;
    entries.push(...splitNarrationByLinePatterns(narrBuf, speakerSet));
    narrBuf = '';
  };
  for (const chunk of chunks) {
    if (chunk.kind === 'narr') {
      narrBuf += chunk.text;
    } else {
      flushNarr();
      entries.push({ id: uuid(), type: 'dialogue', speaker: chunk.speaker, content: chunk.text, timestamp: Date.now() });
    }
  }
  flushNarr();
  return entries;
}

/**
 * Line-level rescue for `[speaker] content` and `speaker："content"` patterns
 * — handles cases the inline-quote scanner doesn't, like a bare line of the
 * form "[弗兰克] 闭嘴！" or "弗兰克："闭嘴！"" standing alone.
 */
function splitNarrationByLinePatterns(
  narration: string,
  speakerSet: Set<string>,
): NarrativeEntry[] {
  const entries: NarrativeEntry[] = [];
  const lines = narration.split(/\r?\n/);
  let narrBuf: string[] = [];
  const flush = () => {
    const text = narrBuf.join('\n').trim();
    if (text) entries.push({ id: uuid(), type: 'narration', content: text, timestamp: Date.now() });
    narrBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { narrBuf.push(''); continue; }

    // Pattern 1: [speaker] content  or  【speaker】 content
    let m = trimmed.match(/^[[［【]\s*([^\]\]】]{1,12})\s*[\]］】]\s*[：:]?\s*(.+)$/);
    if (m) {
      const speaker = m[1].trim();
      const content = stripQuotes(m[2]);
      if (content) {
        flush();
        entries.push({ id: uuid(), type: 'dialogue', speaker, content, timestamp: Date.now() });
        continue;
      }
    }

    // Pattern 2: speaker[说|道|喊|问]?[：:"""「]"content"  — only trust known speakers
    m = trimmed.match(/^([^\s：:"""「]{1,10})\s*(?:说|道|喊道?|问道?)?\s*[：:]\s*["""「](.+?)["""」]\s*[。！？!?.]?$/);
    if (m) {
      const speaker = m[1].trim();
      if (speakerSet.has(speaker)) {
        flush();
        entries.push({ id: uuid(), type: 'dialogue', speaker, content: m[2].trim(), timestamp: Date.now() });
        continue;
      }
    }

    narrBuf.push(line);
  }
  flush();
  return entries;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["'"『「]+|["'"』」]+$/g, '').trim();
}

/**
 * Strict-parse the response if possible, otherwise return null. Tries a
 * ```json fence first, then the first balanced JSON value, then the whole
 * cleaned string. Designed so callers can fall back to a forgiving parser
 * when strict parse fails.
 */
function tryStrictParseResponse(cleaned: string): ParsedNarrationShape | null {
  let jsonStr = cleaned.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleaned);
    if (balanced) jsonStr = balanced;
  }
  try {
    return JSON.parse(jsonStr) as ParsedNarrationShape;
  } catch {
    return null;
  }
}

/**
 * Parse raw LLM JSON response into structured entries. Robust to malformed,
 * truncated, or quasi-JSON output: if strict parse fails we re-use the
 * streaming extractor (extractStreamingState) which tolerates unclosed
 * objects/arrays and still pulls out whatever narration + complete dialogues
 * are present. Only when both paths recover nothing do we render cleaned
 * text as raw narration.
 */
export function parseNarrationResponse(raw: string, story: ParsedStory, playerInput: string) {
  const cleaned = stripThinking(raw);

  // Path A: strict JSON parse
  let parsed = tryStrictParseResponse(cleaned);

  // Path B: recovery via streaming extractor — handles truncation, trailing
  // commas, mid-dialogue cutoffs, and other shapes that break JSON.parse.
  if (!parsed) {
    const streamState = extractStreamingState(cleaned);
    if (streamState.narration || streamState.dialogues.length > 0) {
      parsed = {
        narration: streamState.narration || undefined,
        // Only keep fully-formed dialogues; drop the trailing partial so the
        // reader doesn't get a half-sentence bubble.
        dialogues: streamState.dialogues
          .filter(d => !d.partial && (d.speaker || d.content))
          .map(d => ({ speaker: d.speaker, content: d.content })),
      };
    }
  }

  // Path C: nothing parseable at all — render cleaned text as a narration
  // fallback and offer default choices so the player can still advance.
  if (!parsed || (!parsed.narration && !(parsed.dialogues && parsed.dialogues.length > 0))) {
    const fallbackText = (cleaned || raw).trim();
    return {
      entries: [{
        id: uuid(),
        type: 'narration' as const,
        content: fallbackText || '（模型返回了无法解析的内容）',
        timestamp: Date.now(),
        choices: [
          { id: uuid(), text: '继续观察', isBranchPoint: false },
          { id: uuid(), text: '与附近的人交谈', isBranchPoint: false },
        ],
      }],
      interactions: [],
    };
  }

  // Build roster of known speakers (story characters + player) to use as an
  // allow-list when rescuing misplaced inline dialogue. Include '???' for
  // the "mystery speaker" convention we allow in the prompt.
  const knownSpeakers = [...story.characters.map(c => c.name), '???'];

  const entries: NarrativeEntry[] = [];
  if (parsed.narration) {
    // Rescue any dialogue the model accidentally inlined into narration,
    // producing an interleaved sequence of narration + dialogue entries.
    const rescued = rescueEntriesFromNarration(parsed.narration, knownSpeakers);
    entries.push(...rescued);
  }
  for (const d of parsed.dialogues || []) {
    const speaker = (d.speaker || '').trim();
    const content = (d.content || '').trim();
    // Skip empty-content dialogues (e.g. a speaker tab with no line).
    if (!content) continue;
    entries.push({ id: uuid(), type: 'dialogue', speaker, content, timestamp: Date.now() });
  }
  const choices: StoryChoice[] = (parsed.choices || []).map(c => ({ id: uuid(), text: c.text, isBranchPoint: c.isBranchPoint }));
  // If recovery path B gave us no choices, synthesize a pair of neutral ones
  // so the turn isn't a dead end.
  const finalChoices: StoryChoice[] = choices.length > 0
    ? choices
    : [
        { id: uuid(), text: '继续观察', isBranchPoint: false },
        { id: uuid(), text: '开口说些什么', isBranchPoint: false },
      ];
  if (entries.length > 0) entries[entries.length - 1].choices = finalChoices;

  const interactions = (parsed.interactions || []).map(inter => {
    const char = story.characters.find(c => c.name === inter.characterName);
    return char ? {
      characterId: char.id, characterName: char.name,
      interactions: [{ event: inter.event, playerAction: playerInput, characterReaction: inter.reaction, sentiment: inter.sentiment as 'positive' | 'neutral' | 'negative' }],
    } : null;
  }).filter(Boolean);

  return { entries, interactions };
}

/**
 * Ask the narrator engine for a short OOC ("out of character") hint.
 * This is the @system flow — does NOT advance the story, is not recorded in
 * narrative history, and receives a tightly scoped prompt to avoid spoilers.
 */
export async function systemHintBrowser(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  history: NarrativeEntry[],
  question: string,
): Promise<string> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;

  const recentContext = history.slice(-6).map(entry => {
    switch (entry.type) {
      case 'narration': return `[叙事] ${entry.content}`;
      case 'dialogue': return `[${entry.speaker}] ${entry.content}`;
      case 'player-action': return `[玩家] ${entry.content}`;
      default: return entry.content;
    }
  }).join('\n\n');

  const systemPrompt = `你是互动叙事引擎的"系统顾问"，为玩家提供简短的游戏提示。

## 规则
- 你的回答对剧情透明，不计入对话历史。
- 回答必须简短（不超过 120 字），直接实用，像一个"小声耳语"。
- **严禁剧透**：不暴露未来的事件走向、角色秘密、未揭示的真相。
- 可以做的事：
  - 提醒玩家当前的场景元素（有哪些人可以交互、有哪些可见的选项）
  - 解释世界观规则的含义
  - 给出与剧情目标相关的建议方向（但不指定具体动作）
  - 澄清玩家之前对话中可能没理解的细节
- 不要用 JSON 或任何结构化格式，直接用自然语言回答。

## 故事背景
${story.title} · ${story.worldSetting.era} · ${story.worldSetting.genre}

## 玩家
${playerChar?.name || '旅人'}（${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}）

## 最近的剧情
${recentContext || '（故事刚开始）'}
`;

  const answer = await callLLMBrowser(config, systemPrompt, question, {
    temperature: 0.5,
    maxTokens: 400,
  });
  // Reasoning models may wrap their thought process in <think>…</think>.
  // The system hint is plain text for the UI — strip any such block before
  // returning, and also chop any leftover trailing tags.
  return stripThinking(answer).trim();
}

/**
 * Stream narration + dialogues. onStreamProgress fires whenever the extracted
 * state materially changes (new narration text, a dialogue completes, or the
 * partial last dialogue grows). The UI can replace its displayed state
 * wholesale on each callback without tracking deltas.
 */
export async function streamNarrationBrowser(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  guardrail: GuardrailParams,
  balance: NarrativeBalance,
  history: NarrativeEntry[],
  playerInput: string,
  onStreamProgress: (state: StreamingState) => void,
  mentionedCharacterNames?: string[],
  fromChoice?: boolean,
): Promise<string> {
  const systemPrompt = buildWorldSystemPrompt(story, playerConfig, guardrail, balance);
  const historyContext = buildHistoryContext(history);
  const mentionHint = mentionedCharacterNames && mentionedCharacterNames.length > 0
    ? `\n\n## 玩家明确指向的对象\n玩家在本次行动中主动面向并互动的角色：${mentionedCharacterNames.join('、')}。请让这些角色在回应中发挥主要作用（如对话、反应）。`
    : '';
  const choiceHint = fromChoice
    ? `\n\n## 注意\n玩家是从预设选项中选取了一个行动。请以此为起点让剧情**实质推进**（一件具体的事发生），不要用氛围描写填充替代真正的进展。`
    : '';
  const userMessage = historyContext
    ? `## 之前的剧情\n${historyContext}\n\n## 玩家当前行动\n${playerInput}${mentionHint}${choiceHint}`
    : `故事开始。玩家已进入故事世界。\n\n玩家的第一个行动：${playerInput || '（观察周围环境）'}${mentionHint}${choiceHint}`;

  let full = '';
  let lastSignature = '';
  for await (const token of streamLLMBrowser(config, systemPrompt, userMessage, {
    temperature: 0.3 + guardrail.temperature * 0.7,
    maxTokens: 4096,
  })) {
    full += token;
    const state = extractStreamingState(full);
    const sig = signatureOf(state);
    if (sig !== lastSignature) {
      lastSignature = sig;
      onStreamProgress(state);
    }
  }
  return full;
}

function signatureOf(state: StreamingState): string {
  const dsig = state.dialogues
    .map(d => `${d.partial ? 'P' : 'F'}|${d.speaker}|${d.content.length}`)
    .join('/');
  return `${state.narration.length}@${dsig}`;
}

/**
 * Compress the narrative history into a turn-numbered transcript suitable for
 * feeding to the epilogue generator. Long narration blocks are trimmed; very
 * long playthroughs keep the first few turns plus the most recent ones.
 */
function buildPlaythroughTranscript(history: NarrativeEntry[], playerName: string): string {
  const turns: string[] = [];
  let current: string[] = [];
  let turnNum = 0;
  const flush = () => {
    if (current.length > 0) {
      turns.push(`【第 ${turnNum || 1} 幕】\n${current.join('\n')}`);
      current = [];
    }
  };
  for (const entry of history) {
    if (entry.type === 'player-action') {
      flush();
      turnNum++;
      current.push(`${playerName}（玩家行动）: ${entry.content}`);
    } else if (entry.type === 'narration') {
      const c = entry.content || '';
      current.push(`[叙事] ${c.length > 400 ? c.slice(0, 400) + '…' : c}`);
    } else if (entry.type === 'dialogue') {
      current.push(`${entry.speaker}: "${entry.content}"`);
    } else if (entry.type === 'system') {
      current.push(`[系统] ${entry.content}`);
    }
  }
  flush();

  if (turns.length > 45) {
    const head = turns.slice(0, 3);
    const tail = turns.slice(turns.length - 35);
    const skipped = turns.length - head.length - tail.length;
    return [...head, `\n……（中间省略 ${skipped} 幕，但这些事件确实发生过）……\n`, ...tail].join('\n\n');
  }
  return turns.join('\n\n');
}

function sentimentLabel(s: string): string {
  if (s === 'positive') return '好感上升';
  if (s === 'negative') return '嫌隙加深';
  return '中立';
}

/** One in-flight or completed epilogue entry as the stream progresses. */
export type EpilogueStreamEntry = {
  characterName: string;
  memoir: string;
  /** True when the object is not yet closed in the JSON stream. */
  partial?: boolean;
};
export type EpilogueStreamState = {
  /** Fully formed memoirs emitted by the model so far. */
  entries: EpilogueStreamEntry[];
  /** Total expected (helps the UI draw a determinate progress bar). */
  expectedCount: number;
};

/**
 * Extract memoirs from a streaming JSON array buffer. Reuses the same
 * balanced-object walker as the dialogue streamer. The final partial object
 * (if any) surfaces as an entry with `partial: true` so the UI can render
 * its characterName while the memoir text is still being written.
 */
function extractStreamingEpilogue(buffer: string, expectedCount: number): EpilogueStreamState {
  // Strip reasoning-model thinking first so a mid-stream <think> block
  // doesn't crash through as if it were the memoir body.
  const cleaned = stripThinking(buffer);
  const entries: EpilogueStreamEntry[] = [];

  const arrStart = cleaned.indexOf('[');
  if (arrStart < 0) return { entries, expectedCount };

  let i = arrStart + 1;
  while (i < cleaned.length) {
    while (i < cleaned.length && /[\s,]/.test(cleaned[i])) i++;
    if (i >= cleaned.length) break;
    if (cleaned[i] === ']') break;
    if (cleaned[i] !== '{') break;

    const complete = tryParseBalancedObject(cleaned, i);
    if (complete) {
      const val = complete.value as { characterName?: string; memoir?: string };
      if (val.characterName || val.memoir) {
        entries.push({ characterName: val.characterName || '', memoir: val.memoir || '' });
      }
      i = complete.endIdx;
    } else {
      // Partial trailing memoir — pull whatever fields have started.
      const slice = cleaned.slice(i);
      const nameKey = slice.match(/"characterName"\s*:\s*"/);
      const memoirKey = slice.match(/"memoir"\s*:\s*"/);
      const name = nameKey && nameKey.index !== undefined
        ? decodePartialJSONString(slice, nameKey.index + nameKey[0].length).value
        : '';
      const memoir = memoirKey && memoirKey.index !== undefined
        ? decodePartialJSONString(slice, memoirKey.index + memoirKey[0].length).value
        : '';
      if (name || memoir) {
        entries.push({ characterName: name, memoir, partial: true });
      }
      break;
    }
  }
  return { entries, expectedCount };
}

/**
 * Generate per-character memoirs grounded in the actual playthrough. Each
 * character's section gets their personality, full interaction log, and the
 * complete playthrough transcript so the model writes from concrete lived
 * events rather than echoing the source material.
 *
 * Streams each memoir as it completes via `onProgress`, enabling a
 * determinate progress bar and incremental card reveal.
 */
export async function generateEpilogueBrowser(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  characterInteractions: { characterId: string; characterName: string; interactions: { event: string; playerAction: string; characterReaction: string; sentiment: string }[] }[],
  narrativeHistory: NarrativeEntry[],
  onProgress?: (state: EpilogueStreamState) => void,
): Promise<{ characterId: string; characterName: string; memoir: string }[]> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const playerName = playerChar?.name || '旅人';

  // Collect characters who actually participated: either they had tracked
  // interactions, or they spoke dialogue, or they were explicitly addressed.
  const speakers = new Set<string>();
  for (const e of narrativeHistory) {
    if (e.type === 'dialogue' && e.speaker && e.speaker !== playerName) {
      speakers.add(e.speaker);
    }
  }
  const interactionMap = new Map(characterInteractions.map(ci => [ci.characterName, ci]));

  let participants = story.characters.filter(c =>
    c.id !== playerChar?.id && (interactionMap.has(c.name) || speakers.has(c.name))
  );

  if (participants.length === 0) return [];

  // Rank by richness of interaction when there are many, so the single LLM
  // call has room to give each memoir proper depth.
  if (participants.length > 10) {
    participants.sort((a, b) => {
      const aCount = (interactionMap.get(a.name)?.interactions.length || 0) + (speakers.has(a.name) ? 1 : 0);
      const bCount = (interactionMap.get(b.name)?.interactions.length || 0) + (speakers.has(b.name) ? 1 : 0);
      return bCount - aCount;
    });
    participants = participants.slice(0, 10);
  }

  const characterSections = participants.map(c => {
    const ci = interactionMap.get(c.name);
    const dialogueLines = narrativeHistory.filter(e => e.type === 'dialogue' && e.speaker === c.name).length;
    const interactionLog = ci && ci.interactions.length > 0
      ? ci.interactions.map((i, idx) =>
          `  ${idx + 1}. 事件：${i.event}\n     玩家的做法：${i.playerAction}\n     我（${c.name}）的反应：${i.characterReaction}\n     那一刻我对玩家的感受：${sentimentLabel(i.sentiment)}`
        ).join('\n')
      : '  （无结构化互动记录，但我在叙事中出现过，见下方叙事记录。）';
    return `### ${c.name}
性格：${c.personality || '（未详述）'}
背景：${c.background || '（未详述）'}
本次游玩中我开口说话 ${dialogueLines} 次。
与玩家的互动记录：
${interactionLog}`;
  }).join('\n\n');

  const transcript = buildPlaythroughTranscript(narrativeHistory, playerName);

  const systemPrompt = `你是互动叙事的"后日谈生成器"。玩家刚刚完成了一次**独一无二的游玩经历**，你需要让每个与玩家有过交集的角色，以第一人称写一段对玩家的回忆。

## 核心原则（非常重要）
1. **严禁复述原作剧情**。这次游玩里发生的所有事件，哪怕与原作同名，也应以**本次游玩中真实呈现的细节**为准。不要写"据说发生过"、"在那个故事里"这类模糊说法。
2. **必须直接引用本次游玩中的具体片段**：具体的对话原话、玩家做过的具体动作、事件发生的具体场景。每个回忆里至少出现 **2-3 个**可以对应到下方叙事记录的具体细节。
3. **用角色自己的声音写**：参考每个角色的性格（personality）和背景（background），让 diction、用词习惯、情感偏好符合这个角色。不同角色的回忆要有明显的语气差异。
4. **情感轨迹必须体现**：如果某个角色与玩家的互动记录显示了明显的情感变化（比如从中立到好感、或从好感到嫌隙），这个转变必须在回忆里被写出来，并指出是哪个具体事件造成的。
5. 第一人称叙述，每段 **200-400 字**。可以包含评价、遗憾、感激、困惑、怅惘等情感，不要只陈述事件。

## 输出格式
严格 JSON 数组，按下方"需要写回忆的角色"中的顺序：
[
  { "characterName": "角色名", "memoir": "第一人称回忆文字" }
]
只返回 JSON，不要任何其他文字。`;

  const userMessage = `## 故事世界
${story.title} · ${story.worldSetting.era} · ${story.worldSetting.genre}

## 玩家
名字：${playerName}
进入方式：${playerConfig.entryMode === 'soul-transfer' ? '魂穿（扮演既有角色）' : '转生（全新原创角色）'}
身份：${playerChar?.description || '（无）'}
性格：${playerChar?.personality || '（无）'}

## 需要写回忆的角色（共 ${participants.length} 位，请按此顺序输出）
${characterSections}

## 本次游玩的完整叙事记录
${transcript}

请基于上面这次独有的游玩记录，为每位角色写一段第一人称的回忆。`;

  const expectedCount = participants.length;
  let full = '';
  let lastSig = '';
  if (onProgress) onProgress({ entries: [], expectedCount });
  for await (const token of streamLLMBrowser(config, systemPrompt, userMessage, {
    temperature: 0.7,
    maxTokens: 4096,
  })) {
    full += token;
    if (onProgress) {
      const state = extractStreamingEpilogue(full, expectedCount);
      const sig = state.entries.map(e => `${e.partial ? 'P' : 'F'}|${e.characterName}|${e.memoir.length}`).join('/');
      if (sig !== lastSig) {
        lastSig = sig;
        onProgress(state);
      }
    }
  }

  const cleanedFull = stripThinking(full);
  let jsonStr = cleanedFull.trim();
  const m = cleanedFull.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleanedFull);
    if (balanced) jsonStr = balanced;
  }
  const parsed: { characterName: string; memoir: string }[] = JSON.parse(jsonStr);
  return parsed.map(p => {
    const char = story.characters.find(c => c.name === p.characterName);
    return { characterId: char?.id || '', characterName: p.characterName, memoir: p.memoir };
  });
}

/** Generate reincarnation character (non-streaming) */
export async function generateReincarnationBrowser(config: LLMConfig, story: ParsedStory) {
  const systemPrompt = `根据以下世界观，生成一个符合背景的全新原创角色。返回严格JSON：
{ "name": "角色名", "description": "外貌及身份简述", "personality": "性格特征", "background": "背景故事" }`;

  const worldInfo = `世界：${story.title}\n时代：${story.worldSetting.era}\n类型：${story.worldSetting.genre}\n设定：${story.worldSetting.rules.join('；')}\n已有角色：${story.characters.map(c => c.name).join('、')}`;
  const response = await callLLMBrowser(config, systemPrompt, worldInfo, { temperature: 0.8 });
  const cleaned = stripThinking(response);
  let jsonStr = cleaned.trim();
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleaned);
    if (balanced) jsonStr = balanced;
  }
  return JSON.parse(jsonStr);
}
