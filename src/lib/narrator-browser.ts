/** 浏览器端叙事生成 - 直接调用 LLM API */

import { callLLMBrowser, streamLLMBrowser } from './llm-browser';
import {
  buildWorldSystemPrompt as buildWorldSystemPromptTpl,
  buildHistoryContext,
  MENTION_HINT_TEMPLATE,
  CHOICE_HINT,
  buildSystemHintPrompt,
  EPILOGUE_SYSTEM_PROMPT,
  buildEpilogueUserMessage,
  REINCARNATION_SYSTEM_PROMPT,
  buildReincarnationUserMessage,
  STORY_ARC_SYSTEM_PROMPT,
  buildStoryArcUserMessage,
  type RenderedSelection,
} from './prompts';
import {
  Character, InjectionConfig,
  LLMConfig, ParsedStory, PlayerConfig, GuardrailParams,
  NarrativeBalance, NarrativeEntry, StoryChoice,
  CharacterInteraction, StoryArcStats, StoryArcReport, EpilogueEntry,
} from './types';
import { v4 as uuid } from 'uuid';

export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  mode: 'smart',
  windowSize: 5,
  expandDepth: 1,
  maxTriggered: 8,
};

/**
 * Per-call breakdown of which characters/locations were elevated to detailed
 * injection vs left in the roster. Returned alongside the prompt so the caller
 * can log telemetry (we don't expose this to the player UI by design — leaking
 * the trigger trace would spoil hidden lore).
 */
export interface LoreInjectionTrace {
  mode: InjectionConfig['mode'];
  detailed: string[];
  roster: string[];
  locations: string[];
  reasons: {
    constant: string[];
    mention: string[];
    input: string[];
    recent: string[];
    expanded: string[];
  };
}

interface LoreSelection {
  detailedCharIds: Set<string>;
  rosterCharIds: Set<string>;
  detailedLocationIds: Set<string>;
  trace: LoreInjectionTrace;
}

/**
 * Decide which characters and locations get full detail this turn.
 *
 * `full` mode reproduces the legacy behavior — all non-player characters with
 * their personality+background, every location injected. Use it as a kill
 * switch if smart selection misbehaves.
 *
 * `smart` mode walks four tiers, stopping when `maxTriggered` is reached:
 *   1. Constant — the player's directly related characters (their own
 *      `relationships`, capped at 3). These never miss.
 *   2. Triggered — names appearing in the explicit @ mention list, then in
 *      `playerInput`, then in the last `windowSize` narrative entries.
 *   3. Expanded — 1-degree neighbors of the triggered set via
 *      `relationships`. Skipped when `expandDepth = 0`.
 *   4. Roster — every remaining non-player character gets a single-line
 *      `【name】description` so the LLM still recognizes them by name.
 *
 * Locations follow a simpler rule: triggered by name match in the same scan
 * text; un-triggered locations are dropped entirely (the legacy code never
 * injected locations at all, so this is a strict gain).
 */
function selectActiveLore(
  story: ParsedStory,
  playerChar: Character | undefined,
  history: NarrativeEntry[],
  playerInput: string,
  mentioned: string[] | undefined,
  config: InjectionConfig,
): LoreSelection {
  const charsByName = new Map<string, Character>();
  const charsById = new Map<string, Character>();
  for (const c of story.characters) {
    if (playerChar && c.id === playerChar.id) continue;
    if (c.name) charsByName.set(c.name, c);
    charsById.set(c.id, c);
  }

  const reasons = {
    constant: [] as string[],
    mention: [] as string[],
    input: [] as string[],
    recent: [] as string[],
    expanded: [] as string[],
  };

  if (config.mode === 'full') {
    const detailedCharIds = new Set(charsById.keys());
    const detailedLocationIds = new Set(story.locations.map(l => l.id));
    return {
      detailedCharIds,
      rosterCharIds: new Set(),
      detailedLocationIds,
      trace: {
        mode: 'full',
        detailed: [...charsById.values()].map(c => c.name),
        roster: [],
        locations: story.locations.map(l => l.name),
        reasons,
      },
    };
  }

  const detailedIds = new Set<string>();
  const addById = (id: string, bucket: keyof typeof reasons) => {
    if (!charsById.has(id) || detailedIds.has(id)) return;
    if (detailedIds.size >= config.maxTriggered) return;
    detailedIds.add(id);
    reasons[bucket].push(charsById.get(id)!.name);
  };

  if (playerChar?.relationships) {
    for (const rel of playerChar.relationships.slice(0, 3)) {
      addById(rel.characterId, 'constant');
    }
  }

  const recentEntries = history.slice(-config.windowSize);
  const recentText = recentEntries
    .map(e => `${e.speaker || ''} ${e.content || ''}`)
    .join(' ');

  if (mentioned) {
    for (const name of mentioned) {
      const c = charsByName.get(name);
      if (c) addById(c.id, 'mention');
    }
  }
  for (const c of charsByName.values()) {
    if (playerInput.includes(c.name)) addById(c.id, 'input');
  }
  for (const c of charsByName.values()) {
    if (recentText.includes(c.name)) addById(c.id, 'recent');
  }

  if (config.expandDepth >= 1) {
    const seeds = [...detailedIds];
    outer: for (const seedId of seeds) {
      const seed = charsById.get(seedId);
      if (!seed?.relationships) continue;
      for (const rel of seed.relationships) {
        if (detailedIds.size >= config.maxTriggered) break outer;
        addById(rel.characterId, 'expanded');
      }
    }
  }

  const rosterIds = new Set<string>();
  for (const id of charsById.keys()) {
    if (!detailedIds.has(id)) rosterIds.add(id);
  }

  const detailedLocationIds = new Set<string>();
  const locScanText = recentText + ' ' + playerInput;
  const triggeredLocations: string[] = [];
  for (const loc of story.locations) {
    if (loc.name && locScanText.includes(loc.name)) {
      detailedLocationIds.add(loc.id);
      triggeredLocations.push(loc.name);
    }
  }

  return {
    detailedCharIds: detailedIds,
    rosterCharIds: rosterIds,
    detailedLocationIds,
    trace: {
      mode: 'smart',
      detailed: [...detailedIds].map(id => charsById.get(id)?.name || id),
      roster: [...rosterIds].map(id => charsById.get(id)?.name || id),
      locations: triggeredLocations,
      reasons,
    },
  };
}

/**
 * Render the LoreSelection into the string fragments the prompt template needs,
 * then call the prompt template. Keeps selection logic here (it's runtime
 * state) and prompt phrasing in src/lib/prompts/dialogue-runtime.ts.
 */
function renderSelection(story: ParsedStory, selection: LoreSelection): RenderedSelection {
  const detailedChars = story.characters.filter(c => selection.detailedCharIds.has(c.id));
  const rosterChars = story.characters.filter(c => selection.rosterCharIds.has(c.id));
  const detailedLines = detailedChars
    .map(c => `【${c.name}】${c.personality}。${c.background}`)
    .join('\n');
  const rosterLines = rosterChars
    .map(c => {
      const blurb = c.description || c.personality?.slice(0, 30) || '';
      return blurb ? `【${c.name}】${blurb}` : `【${c.name}】`;
    })
    .join('\n');
  const detailedLocations = story.locations
    .filter(l => selection.detailedLocationIds.has(l.id))
    .map(l => ({ name: l.name, description: l.description }));
  return { detailedLines, rosterLines, detailedLocations };
}

function buildWorldSystemPrompt(
  story: ParsedStory,
  playerConfig: PlayerConfig,
  guardrail: GuardrailParams,
  balance: NarrativeBalance,
  selection: LoreSelection,
): string {
  return buildWorldSystemPromptTpl(
    story, playerConfig, guardrail, balance, renderSelection(story, selection),
  );
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

/**
 * Try to repair the most common LLM JSON mistakes before `JSON.parse`.
 *
 * Observed cases (real bug reports):
 *   1. Missing closing quote on a key: `"text: "value"` → should be `"text": "value"`.
 *      Pattern: `[{,] "<ascii-key-ident>: "` — the `:` is right next to the
 *      key chars without a closing `"`. We restrict the key to ASCII
 *      identifiers so this never matches anything inside a Chinese string.
 *   2. Trailing commas before `]` or `}` (some models emit JS-style).
 *
 * Anything fancier (re-balancing braces, stripping mid-string newlines)
 * is too risky and is left to the streaming-state fallback below.
 */
function sanitizeLikelyJSON(jsonStr: string): string {
  return jsonStr
    .replace(/([{,]\s*)"([a-zA-Z_$][\w$]*?):\s+/g, '$1"$2": ')
    .replace(/,(\s*[\]}])/g, '$1');
}

/**
 * Last-resort recovery when `JSON.parse` (and its sanitized retry) both
 * fail. We use the streaming-state extractor — which works on a partial
 * buffer by walking the JSON character by character — to pull out
 * narration + dialogues + choices + interactions individually. Bad
 * objects inside arrays are skipped; good ones survive. This means the
 * one buggy choice in a 3-choice payload doesn't kill the whole turn.
 */
function recoverFromMalformedJSON(buffer: string): {
  narration: string;
  dialogues: { speaker: string; content: string }[];
  choices: { text: string; isBranchPoint: boolean }[];
  interactions: { characterName: string; event: string; reaction: string; sentiment: string }[];
} {
  const state = extractStreamingState(buffer);
  // extractStreamingState already drops a partial trailing dialogue when
  // it can't be parsed; we just need the completed ones for the final
  // result. Filter out objects flagged `partial`.
  const dialogues = state.dialogues
    .filter(d => !d.partial && (d.speaker || d.content))
    .map(d => ({ speaker: d.speaker, content: d.content }));

  const choices = recoverArrayOfObjects<{ text: string; isBranchPoint: boolean }>(
    buffer, 'choices',
    (obj) => obj && typeof obj === 'object'
      ? { text: String((obj as Record<string, unknown>).text || ''), isBranchPoint: Boolean((obj as Record<string, unknown>).isBranchPoint) }
      : null,
  ).filter(c => c.text);

  const interactions = recoverArrayOfObjects<{ characterName: string; event: string; reaction: string; sentiment: string }>(
    buffer, 'interactions',
    (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      const o = obj as Record<string, unknown>;
      return {
        characterName: String(o.characterName || ''),
        event: String(o.event || ''),
        reaction: String(o.reaction || ''),
        sentiment: String(o.sentiment || 'neutral'),
      };
    },
  ).filter(i => i.characterName);

  return { narration: state.narration, dialogues, choices, interactions };
}

/**
 * Walk a top-level array key in a JSON buffer, lifting each balanced
 * `{...}` it contains and feeding it through `mapper`. Bad objects are
 * silently dropped. Used by `recoverFromMalformedJSON` to salvage
 * choices / interactions when the doc as a whole won't parse.
 */
function recoverArrayOfObjects<T>(
  buffer: string,
  key: string,
  mapper: (obj: unknown) => T | null,
): T[] {
  const cleaned = stripThinking(buffer);
  const out: T[] = [];
  const m = cleaned.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
  if (!m || m.index === undefined) return out;
  let i = m.index + m[0].length;
  while (i < cleaned.length) {
    while (i < cleaned.length && /[\s,]/.test(cleaned[i])) i++;
    if (i >= cleaned.length || cleaned[i] === ']') break;
    if (cleaned[i] !== '{') break;
    const complete = tryParseBalancedObject(cleaned, i);
    if (complete) {
      const mapped = mapper(complete.value);
      if (mapped) out.push(mapped);
      i = complete.endIdx;
    } else {
      // Skip the malformed object: walk to the matching `}` if we can,
      // otherwise bail.
      const skipTo = findClosingBrace(cleaned, i);
      if (skipTo < 0) break;
      i = skipTo + 1;
    }
  }
  return out;
}

/**
 * Walk forward from an opening `{` looking for its matching `}`,
 * counting brace depth and respecting JSON string literals + escapes.
 * Returns the index of the matching `}` or -1 when the buffer runs out.
 *
 * Used for skipping malformed objects in a recover pass: even when
 * `JSON.parse` rejects the slice, we usually still want to find its
 * end so the next sibling can be salvaged.
 */
function findClosingBrace(buffer: string, start: number): number {
  if (buffer[start] !== '{') return -1;
  let depth = 0, inStr = false, esc = false;
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
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse raw LLM JSON response into structured entries */
export function parseNarrationResponse(raw: string, story: ParsedStory, playerInput: string) {
  // Reasoning-model safety: strip thinking wrappers first.
  const cleaned = stripThinking(raw);

  // Prefer explicit ```json fences, then fall back to 'first balanced JSON
  // value in the buffer' (handles untagged preambles/outros), then last-
  // resort the whole cleaned string.
  let jsonStr = cleaned.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleaned);
    if (balanced) jsonStr = balanced;
  }

  type Parsed = {
    narration?: string;
    dialogues?: { speaker: string; content: string }[];
    choices?: { text: string; isBranchPoint: boolean }[];
    interactions?: { characterName: string; event: string; reaction: string; sentiment: string }[];
  };

  // Three-tier parse: strict → sanitized → field-by-field salvage.
  let parsed: Parsed | null = null;
  try {
    parsed = JSON.parse(jsonStr) as Parsed;
  } catch {
    try {
      parsed = JSON.parse(sanitizeLikelyJSON(jsonStr)) as Parsed;
    } catch {
      const recovered = recoverFromMalformedJSON(cleaned);
      // Surface the failure in dev tools so the model behaviour can be
      // tracked over time, but don't show JSON scaffolding to the user.
      console.warn('[narrator] JSON parse failed twice; salvaged via partial extraction.', {
        rawLen: raw.length, narrationLen: recovered.narration.length,
        dialogues: recovered.dialogues.length, choices: recovered.choices.length,
      });
      parsed = recovered;
    }
  }

  const entries: NarrativeEntry[] = [];
  if (parsed.narration) entries.push({ id: uuid(), type: 'narration', content: parsed.narration, timestamp: Date.now() });
  for (const d of parsed.dialogues || []) {
    entries.push({ id: uuid(), type: 'dialogue', speaker: d.speaker, content: d.content, timestamp: Date.now() });
  }
  const choices: StoryChoice[] = (parsed.choices || []).map(c => ({ id: uuid(), text: c.text, isBranchPoint: c.isBranchPoint }));
  if (entries.length > 0 && choices.length > 0) entries[entries.length - 1].choices = choices;

  // If salvage produced nothing usable AT ALL, give the player a minimal
  // recovery option so the story isn't soft-locked.
  if (entries.length === 0) {
    entries.push({
      id: uuid(), type: 'narration',
      content: '（本轮叙事生成异常，请尝试新的输入或选择）',
      timestamp: Date.now(),
      choices: [
        { id: uuid(), text: '继续观察', isBranchPoint: false },
        { id: uuid(), text: '与附近的人交谈', isBranchPoint: false },
      ],
    });
  }

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
  const systemPrompt = buildSystemHintPrompt(story, playerConfig, history);
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
  injectionConfig: InjectionConfig = DEFAULT_INJECTION_CONFIG,
): Promise<string> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const selection = selectActiveLore(
    story, playerChar, history, playerInput, mentionedCharacterNames, injectionConfig,
  );
  const systemPrompt = buildWorldSystemPrompt(story, playerConfig, guardrail, balance, selection);
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[lore]', {
      mode: selection.trace.mode,
      promptChars: systemPrompt.length,
      detailed: selection.trace.detailed,
      rosterCount: selection.trace.roster.length,
      locations: selection.trace.locations,
      reasons: selection.trace.reasons,
    });
  }
  const historyContext = buildHistoryContext(history);
  const mentionHint = mentionedCharacterNames && mentionedCharacterNames.length > 0
    ? MENTION_HINT_TEMPLATE(mentionedCharacterNames)
    : '';
  const choiceHint = fromChoice ? CHOICE_HINT : '';
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
  /** Which phase the generator is currently running. UI uses this to swap
   *  between "正在做旅程总结" and "角色回忆" surfaces. */
  phase: 'arc' | 'memoirs' | 'done';
  /** Story-arc summary, populated once the arc LLM call completes.
   *  `undefined` while the arc is still generating. */
  arcReport?: StoryArcReport;
  /** Fully formed memoirs emitted by the model so far. */
  entries: EpilogueStreamEntry[];
  /** Total expected (helps the UI draw a determinate progress bar). */
  expectedCount: number;
};

/** Final result returned by `generateEpilogueBrowser`. */
export interface EpilogueResult {
  storyArc?: StoryArcReport;
  memoirs: EpilogueEntry[];
}

/**
 * Extract memoirs from a streaming JSON array buffer. Reuses the same
 * balanced-object walker as the dialogue streamer. The final partial object
 * (if any) surfaces as an entry with `partial: true` so the UI can render
 * its characterName while the memoir text is still being written.
 */
function extractStreamingEpilogue(
  buffer: string, expectedCount: number, arcReport?: StoryArcReport,
): EpilogueStreamState {
  // Strip reasoning-model thinking first so a mid-stream <think> block
  // doesn't crash through as if it were the memoir body.
  const cleaned = stripThinking(buffer);
  const entries: EpilogueStreamEntry[] = [];

  const arrStart = cleaned.indexOf('[');
  if (arrStart < 0) return { phase: 'memoirs', arcReport, entries, expectedCount };

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
  return { phase: 'memoirs', arcReport, entries, expectedCount };
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
/**
 * Threshold gates for "main character" selection used by the epilogue.
 * "≥5 turns of intersection AND ≥1 non-neutral sentiment" matches the
 * blueprint's spec; we fall back to the old "any participation" rule
 * when the strict gate would yield zero memoirs (short playthroughs).
 */
const MAIN_CHARACTER_INTERSECTION_MIN = 5;
const MAIN_CHARACTER_SENTIMENT_MIN = 1;

/**
 * Pure derivation of the four blueprint-mandated stats: locations
 * visited, dialogue characters, group-scene count, relationship shifts.
 * Plus a `totalTurns` for the chip layout. No LLM involved.
 */
export function computeStoryArcStats(
  story: ParsedStory,
  history: NarrativeEntry[],
  characterInteractions: CharacterInteraction[],
  playerName: string,
): StoryArcStats {
  const totalTurns = history.filter(e => e.type === 'player-action').length;

  // Locations: scan narration + dialogue text for known location names.
  const locationsSeen = new Set<string>();
  for (const e of history) {
    if (!e.content) continue;
    for (const loc of story.locations) {
      if (loc.name && e.content.includes(loc.name)) locationsSeen.add(loc.id);
    }
  }

  // Dialogue characters: distinct non-player speakers.
  const speakers = new Set<string>();
  for (const e of history) {
    if (e.type === 'dialogue' && e.speaker && e.speaker !== playerName) {
      speakers.add(e.speaker);
    }
  }

  // Group scenes: a "scene" runs from one player-action to the next.
  // Count those segments where ≥3 distinct named characters appear
  // (either as dialogue speakers or mentioned by name in narration).
  let groupSceneCount = 0;
  let scenePeople = new Set<string>();
  const flushScene = () => {
    if (scenePeople.size >= 3) groupSceneCount++;
    scenePeople = new Set<string>();
  };
  for (const e of history) {
    if (e.type === 'player-action') {
      flushScene();
    } else if (e.type === 'dialogue' && e.speaker) {
      if (e.speaker !== playerName) scenePeople.add(e.speaker);
    } else if (e.type === 'narration' && e.content) {
      for (const c of story.characters) {
        if (c.name && e.content.includes(c.name)) scenePeople.add(c.name);
      }
    }
  }
  flushScene();

  // Relationship shifts: every non-neutral interaction entry.
  let relationshipShifts = 0;
  for (const ci of characterInteractions) {
    for (const i of ci.interactions) {
      if (i.sentiment && i.sentiment !== 'neutral') relationshipShifts++;
    }
  }

  return {
    totalTurns,
    locationsVisited: locationsSeen.size,
    dialogueCharacters: speakers.size,
    groupSceneCount,
    relationshipShifts,
  };
}

/**
 * Generate the four-phase 起承转合 recap. One LLM call, non-streaming
 * (the response is short enough — 200-400 字 — that streaming buys
 * little UX; the page shows a "正在做旅程总结" placeholder during the
 * call).
 */
export async function generateStoryArc(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  characterInteractions: CharacterInteraction[],
  narrativeHistory: NarrativeEntry[],
): Promise<StoryArcReport> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const playerName = playerChar?.name || '旅人';

  const stats = computeStoryArcStats(story, narrativeHistory, characterInteractions, playerName);
  const transcript = buildPlaythroughTranscript(narrativeHistory, playerName);
  const shifted = characterInteractions
    .filter(ci => ci.interactions.some(i => i.sentiment && i.sentiment !== 'neutral'))
    .map(ci => ci.characterName);

  const userMessage = buildStoryArcUserMessage({
    playerName,
    storyTitle: story.title,
    storyGenre: story.worldSetting.genre,
    storyEra: story.worldSetting.era,
    transcript,
    stats,
    shiftedRelationships: shifted,
  });

  const raw = await callLLMBrowser(
    config, STORY_ARC_SYSTEM_PROMPT, userMessage,
    { temperature: 0.5, maxTokens: 1500 },
  );
  const cleaned = stripThinking(raw);
  let jsonStr = cleaned.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleaned);
    if (balanced) jsonStr = balanced;
  }
  let parsed: { qi?: string; cheng?: string; zhuan?: string; he?: string } = {};
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.warn('[story-arc] JSON parse failed; emitting empty arc', err);
  }
  return {
    qi: parsed.qi || '',
    cheng: parsed.cheng || '',
    zhuan: parsed.zhuan || '',
    he: parsed.he || '',
    stats,
  };
}

/**
 * End-of-run epilogue: produces a story-arc recap **and** per-character
 * memoirs in one call. Two LLM calls run sequentially:
 *
 *   1. Story arc (起承转合, ~200-400 字) — short, non-streaming.
 *      `onProgress({ phase: 'arc', ... })` fires once at the start so
 *      the UI can show a placeholder; the full state is published when
 *      it completes.
 *   2. Per-character memoirs — streaming as before, gated by the new
 *      "main character" rule (≥5 turns of intersection, ≥1 non-neutral
 *      sentiment) with a fallback to "any participation" for short
 *      playthroughs that would otherwise produce zero memoirs.
 */
export async function generateEpilogueBrowser(
  config: LLMConfig,
  story: ParsedStory,
  playerConfig: PlayerConfig,
  characterInteractions: CharacterInteraction[],
  narrativeHistory: NarrativeEntry[],
  onProgress?: (state: EpilogueStreamState) => void,
): Promise<EpilogueResult> {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const playerName = playerChar?.name || '旅人';

  // Pre-stats so the UI gets the chips even if the LLM fails halfway.
  const initialStats = computeStoryArcStats(
    story, narrativeHistory, characterInteractions, playerName,
  );

  // ---- Phase 1: story arc ------------------------------------------------
  if (onProgress) onProgress({ phase: 'arc', entries: [], expectedCount: 0 });
  let storyArc: StoryArcReport | undefined;
  try {
    storyArc = await generateStoryArc(
      config, story, playerConfig, characterInteractions, narrativeHistory,
    );
  } catch (err) {
    console.warn('[epilogue] story arc generation failed; continuing with stats only', err);
    storyArc = {
      qi: '', cheng: '', zhuan: '', he: '',
      stats: initialStats,
    };
  }

  // ---- Phase 2: pick main characters ------------------------------------
  const speakers = new Set<string>();
  for (const e of narrativeHistory) {
    if (e.type === 'dialogue' && e.speaker && e.speaker !== playerName) {
      speakers.add(e.speaker);
    }
  }
  const interactionMap = new Map(characterInteractions.map(ci => [ci.characterName, ci]));

  // Strict main-character rule: ≥5 turns of intersection + ≥1 non-neutral sentiment.
  const intersectionTurns = (c: Character): number => {
    const dialogueLines = narrativeHistory
      .filter(e => e.type === 'dialogue' && e.speaker === c.name).length;
    const interactionEntries = interactionMap.get(c.name)?.interactions.length || 0;
    return dialogueLines + interactionEntries;
  };
  const sentimentEvents = (c: Character): number =>
    interactionMap.get(c.name)?.interactions
      .filter(i => i.sentiment && i.sentiment !== 'neutral').length || 0;

  let participants = story.characters.filter(c =>
    c.id !== playerChar?.id
    && intersectionTurns(c) >= MAIN_CHARACTER_INTERSECTION_MIN
    && sentimentEvents(c) >= MAIN_CHARACTER_SENTIMENT_MIN,
  );

  // Fallback for short playthroughs: keep the old loose rule so the
  // epilogue is never empty.
  if (participants.length === 0) {
    participants = story.characters.filter(c =>
      c.id !== playerChar?.id && (interactionMap.has(c.name) || speakers.has(c.name))
    );
  }

  if (participants.length === 0) {
    if (onProgress) onProgress({ phase: 'done', arcReport: storyArc, entries: [], expectedCount: 0 });
    return { storyArc, memoirs: [] };
  }

  // Rank when over budget so the single LLM call has room per memoir.
  if (participants.length > 10) {
    participants.sort((a, b) => intersectionTurns(b) - intersectionTurns(a));
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

  const systemPrompt = EPILOGUE_SYSTEM_PROMPT;
  const userMessage = buildEpilogueUserMessage({
    story,
    playerConfig,
    playerName,
    characterSections,
    transcript,
    participantCount: participants.length,
    participantNames: participants.map(p => p.name),
  });

  // ---- Phase 3: stream memoirs -------------------------------------------
  const expectedCount = participants.length;
  let full = '';
  let lastSig = '';
  if (onProgress) onProgress({ phase: 'memoirs', arcReport: storyArc, entries: [], expectedCount });
  for await (const token of streamLLMBrowser(config, systemPrompt, userMessage, {
    temperature: 0.7,
    maxTokens: 4096,
  })) {
    full += token;
    if (onProgress) {
      const state = extractStreamingEpilogue(full, expectedCount, storyArc);
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
  let parsedMemoirs: { characterName: string; memoir: string }[] = [];
  try {
    parsedMemoirs = JSON.parse(jsonStr);
  } catch (err) {
    console.warn('[epilogue] memoir JSON parse failed; trying salvage', err);
    // We don't have a streaming-state-style salvage for memoirs (yet).
    // Fall back to whatever extractStreamingEpilogue already pulled.
    const salvage = extractStreamingEpilogue(cleanedFull, expectedCount, storyArc);
    parsedMemoirs = salvage.entries
      .filter(e => !e.partial)
      .map(e => ({ characterName: e.characterName, memoir: e.memoir }));
  }
  const memoirs = reconcileEpilogueWithParticipants(parsedMemoirs, participants);

  if (onProgress) onProgress({ phase: 'done', arcReport: storyArc, entries: [], expectedCount });
  return { storyArc, memoirs };
}

/**
 * Map LLM-returned `[{characterName, memoir}]` back to the participants we
 * actually asked about. Defends against three realistic LLM mistakes:
 *
 * 1. The model emits an alias instead of the canonical name (e.g. "老白"
 *    when participants list has "沃尔特·怀特"). We do bidirectional
 *    `includes` matching to catch this.
 * 2. The model reorders the array. We honour its ordering only if names
 *    matched cleanly; when a name is unmatched we **fall back to positional
 *    alignment** so a still-readable memoir doesn't get dropped.
 * 3. The model skips a participant or duplicates one. Skipped participants
 *    surface with an empty memoir (so the UI can show "（未留下回忆）"
 *    instead of silently disappearing).
 */
function reconcileEpilogueWithParticipants(
  parsed: { characterName: string; memoir: string }[],
  participants: { id: string; name: string }[],
): { characterId: string; characterName: string; memoir: string }[] {
  const participantsByCanonName = new Map(participants.map(p => [p.name, p]));
  const usedParticipantIds = new Set<string>();

  // First pass: assign each parsed entry to a participant by best-match.
  type Slot = {
    participantId: string | null;
    characterName: string;
    memoir: string;
    matchedBy: 'exact' | 'fuzzy' | 'positional' | 'none';
    parsedIndex: number;
  };
  const slots: Slot[] = parsed.map((p, idx) => {
    const name = (p.characterName || '').trim();
    const memoir = p.memoir || '';

    // Tier 1: exact match.
    const exact = participantsByCanonName.get(name);
    if (exact && !usedParticipantIds.has(exact.id)) {
      usedParticipantIds.add(exact.id);
      return { participantId: exact.id, characterName: exact.name, memoir, matchedBy: 'exact', parsedIndex: idx };
    }

    // Tier 2: bidirectional substring (handles aliases like 老白 ↔ 沃尔特·怀特).
    if (name) {
      const fuzzy = participants.find(p2 =>
        !usedParticipantIds.has(p2.id) &&
        (p2.name.includes(name) || name.includes(p2.name))
      );
      if (fuzzy) {
        usedParticipantIds.add(fuzzy.id);
        return { participantId: fuzzy.id, characterName: fuzzy.name, memoir, matchedBy: 'fuzzy', parsedIndex: idx };
      }
    }

    // Tier 3: defer — assign positionally in the second pass.
    return {
      participantId: null,
      characterName: name || '（无名）',
      memoir,
      matchedBy: 'none',
      parsedIndex: idx,
    };
  });

  // Second pass: positional alignment for unmatched entries.
  const unassignedParticipants = participants.filter(p => !usedParticipantIds.has(p.id));
  let unassignedCursor = 0;
  for (const slot of slots) {
    if (slot.participantId) continue;
    const fallback = unassignedParticipants[unassignedCursor++];
    if (fallback) {
      slot.participantId = fallback.id;
      slot.characterName = fallback.name;
      slot.matchedBy = 'positional';
    }
  }

  // Telemetry for observability — surfaces silently in console only.
  const stats = slots.reduce((acc, s) => {
    acc[s.matchedBy] = (acc[s.matchedBy] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  if ((stats.fuzzy || 0) + (stats.positional || 0) + (stats.none || 0) > 0) {
    console.warn('[epilogue] non-exact reconciliation', {
      stats, parsedCount: parsed.length, participantCount: participants.length,
    });
  }

  // Backfill missing participants the model skipped entirely.
  const finalEntries = slots.map(s => ({
    characterId: s.participantId || '',
    characterName: s.characterName,
    memoir: s.memoir,
  }));
  for (const p of participants) {
    if (!finalEntries.some(e => e.characterId === p.id)) {
      finalEntries.push({
        characterId: p.id,
        characterName: p.name,
        memoir: '（这一位没有留下文字。也许沉默才是 ta 此刻的回答。）',
      });
    }
  }
  return finalEntries;
}

/** Generate reincarnation character (non-streaming) */
export async function generateReincarnationBrowser(config: LLMConfig, story: ParsedStory) {
  const systemPrompt = REINCARNATION_SYSTEM_PROMPT;
  const worldInfo = buildReincarnationUserMessage(story);
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
