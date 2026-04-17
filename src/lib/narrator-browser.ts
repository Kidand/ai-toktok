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
 * for streaming display.
 */
export function extractStreamingNarration(buffer: string): string {
  const keyMatch = buffer.match(/"narration"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return '';
  return decodePartialJSONString(buffer, keyMatch.index + keyMatch[0].length).value;
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
  const narration = extractStreamingNarration(buffer);
  const dialogues: StreamingDialogue[] = [];

  const arrMatch = buffer.match(/"dialogues"\s*:\s*\[/);
  if (!arrMatch || arrMatch.index === undefined) return { narration, dialogues };

  let i = arrMatch.index + arrMatch[0].length;
  while (i < buffer.length) {
    while (i < buffer.length && /[\s,]/.test(buffer[i])) i++;
    if (i >= buffer.length) break;
    if (buffer[i] === ']') break;
    if (buffer[i] !== '{') break;

    const complete = tryParseBalancedObject(buffer, i);
    if (complete) {
      const val = complete.value as { speaker?: string; content?: string };
      if (val.speaker || val.content) {
        dialogues.push({ speaker: val.speaker || '', content: val.content || '' });
      }
      i = complete.endIdx;
    } else {
      // Partial trailing dialogue — show what we have and stop.
      const partial = extractPartialDialogue(buffer, i);
      if (partial && (partial.content || partial.speaker)) dialogues.push(partial);
      break;
    }
  }
  return { narration, dialogues };
}

/** Parse raw LLM JSON response into structured entries */
export function parseNarrationResponse(raw: string, story: ParsedStory, playerInput: string) {
  let jsonStr = raw;
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1];

  let parsed: { narration?: string; dialogues?: { speaker: string; content: string }[]; choices?: { text: string; isBranchPoint: boolean }[]; interactions?: { characterName: string; event: string; reaction: string; sentiment: string }[] };
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    return {
      entries: [{ id: uuid(), type: 'narration' as const, content: raw, timestamp: Date.now(),
        choices: [{ id: uuid(), text: '继续观察', isBranchPoint: false }, { id: uuid(), text: '与附近的人交谈', isBranchPoint: false }] }],
      interactions: [],
    };
  }

  const entries: NarrativeEntry[] = [];
  if (parsed.narration) entries.push({ id: uuid(), type: 'narration', content: parsed.narration, timestamp: Date.now() });
  for (const d of parsed.dialogues || []) {
    entries.push({ id: uuid(), type: 'dialogue', speaker: d.speaker, content: d.content, timestamp: Date.now() });
  }
  const choices: StoryChoice[] = (parsed.choices || []).map(c => ({ id: uuid(), text: c.text, isBranchPoint: c.isBranchPoint }));
  if (entries.length > 0 && choices.length > 0) entries[entries.length - 1].choices = choices;

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

  return callLLMBrowser(config, systemPrompt, question, {
    temperature: 0.5,
    maxTokens: 400,
  });
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

/** Generate epilogue (non-streaming, called once at end) */
export async function generateEpilogueBrowser(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  characterInteractions: { characterId: string; characterName: string; interactions: { event: string; playerAction: string; characterReaction: string; sentiment: string }[] }[],
): Promise<{ characterId: string; characterName: string; memoir: string }[]> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId) : playerConfig.customCharacter;

  const interactionSummary = characterInteractions.map(ci => {
    const events = ci.interactions.map(i =>
      `- 事件：${i.event}，玩家行动：${i.playerAction}，${ci.characterName}的反应：${i.characterReaction}（${i.sentiment}）`
    ).join('\n');
    return `【${ci.characterName}】\n${events}`;
  }).join('\n\n');

  const systemPrompt = `你是一个后日谈生成器。故事已经结束，为每个角色生成回忆评价。
故事世界：${story.title}
玩家角色：${playerChar?.name || '旅人'}

要求：回忆必须精准提到具体事件，语气符合角色性格，以第一人称叙述。
返回严格JSON：[{ "characterName": "角色名", "memoir": "回忆评价（200-400字）" }]`;

  const response = await callLLMBrowser(config, systemPrompt, `## 交互记录\n${interactionSummary}`, { temperature: 0.6 });
  let jsonStr = response;
  const m = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1];
  const parsed: { characterName: string; memoir: string }[] = JSON.parse(jsonStr.trim());
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
  let jsonStr = response;
  const m = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1];
  return JSON.parse(jsonStr.trim());
}
