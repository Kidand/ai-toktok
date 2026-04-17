/**
 * 客户端故事解析 - 增量图谱构建
 *
 * 流程：
 *   1. 按段落切片
 *   2. 串行解析每一片；第 k 片的 prompt 携带前 k-1 片累积出的图谱摘要，
 *      LLM 被引导复用已知实体名（自动别名消解），并补充新信息
 *   3. 每完成一片，即合并到累积图谱并按 (全文哈希, 片号) 缓存快照，
 *      失败重试可从最高成功点继续
 *   4. 全部处理完后做一次小型 LLM 润色，生成统一 title/summary/timeline
 */

import { callLLMBrowser, streamLLMBrowser } from './llm-browser';
import { LLMConfig, ParsedStory, Character, Location, KeyEvent, WorldSetting } from './types';
import { v4 as uuid } from 'uuid';

const CHUNK_MAX_CHARS = 24000;
const MAX_RETRIES = 3;
const PROMPT_VERSION = '4'; // bump invalidates all prior caches
const CACHE_PREFIX = 'ai-toktok-graph-cache:';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type RawCharacter = {
  name: string; description?: string; personality?: string; background?: string;
  relationships?: { targetName: string; relation: string }[];
};
type RawLocation = { name: string; description?: string };
type RawEvent = {
  title: string; description: string; timeIndex?: number;
  involvedCharacters?: string[]; locationName?: string;
};
type RawWorldSetting = {
  era?: string; genre?: string; rules?: string[]; toneDescription?: string;
};

/** Accumulated graph; grows as chunks are processed */
type Graph = {
  title?: string;
  summary?: string;
  worldSetting: RawWorldSetting;
  characters: RawCharacter[];
  locations: RawLocation[];
  keyEvents: RawEvent[];
  timelineDescription?: string;
};

type ChunkParseResult = {
  title?: string;
  summary?: string;
  worldSetting?: RawWorldSetting;
  newCharacters?: RawCharacter[];
  updatedCharacters?: RawCharacter[];  // name matches an existing one
  newLocations?: RawLocation[];
  keyEvents?: RawEvent[];
  timelineDescription?: string;
};

export type ParseProgress = {
  phase: 'split' | 'parse' | 'polish' | 'build';
  current: number;
  total: number;
  resumedFrom?: number;   // if resumed from cache, the chunk index we started from
  retrying?: number;      // chunk currently retrying
  characters?: number;    // running character count (for UX)
};

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

const INITIAL_PARSE_PROMPT = `你是一个专业的故事分析AI。解析用户提供的故事文本片段，提取关键信息。
必须返回严格JSON，不要任何其他文字：

{
  "title": "（猜测）故事标题",
  "summary": "本片段梗概（100-200字）",
  "worldSetting": {
    "era": "时代背景",
    "genre": "故事类型",
    "rules": ["世界规则1", "世界规则2"],
    "toneDescription": "叙事风格"
  },
  "newCharacters": [
    { "name": "角色名", "description": "外貌及身份", "personality": "性格", "background": "背景",
      "relationships": [{ "targetName": "关联角色名", "relation": "关系" }] }
  ],
  "newLocations": [ { "name": "地点名", "description": "描述" } ],
  "keyEvents": [
    { "title": "事件标题", "description": "描述", "timeIndex": 0,
      "involvedCharacters": ["角色名"], "locationName": "地点名" }
  ],
  "timelineDescription": "本片段时间线"
}

注意：
- 提取所有有名字的角色
- **必须包含视角人物/主角**（即使故事以第一人称"我"叙述，或用"他/她"代称而极少提及真名）。
  · 若主角有名字，直接用其名字
  · 若主角全程无名，使用"主角"作为 name，并在 description 里写明"故事的第一人称视角人物"
  · 视角人物通常是玩家最可能想扮演的角色，不能遗漏
- keyEvents 按时间顺序排列`;

function buildIncrementalPrompt(graph: Graph): string {
  const charList = graph.characters.length === 0
    ? '（暂无）'
    : graph.characters.map(c => `- ${c.name}：${c.description || '（无描述）'}`).join('\n');
  const locList = graph.locations.length === 0
    ? '（暂无）'
    : graph.locations.map(l => `- ${l.name}`).join('\n');
  const worldInfo = [
    graph.worldSetting.era && `时代：${graph.worldSetting.era}`,
    graph.worldSetting.genre && `类型：${graph.worldSetting.genre}`,
    graph.worldSetting.toneDescription && `风格：${graph.worldSetting.toneDescription}`,
    graph.worldSetting.rules && graph.worldSetting.rules.length > 0 && `规则：${graph.worldSetting.rules.join('；')}`,
  ].filter(Boolean).join('\n') || '（暂无）';

  return `你是一个专业的故事分析AI。解析新的故事片段，**在已有图谱基础上增量更新**。

## 当前已知图谱

### 已知角色（主名）
${charList}

### 已知地点
${locList}

### 已知世界观
${worldInfo}

## 任务

阅读新的片段，按以下规则输出JSON：

1. **已知角色**出现时（可能用别名、称号、代称如"他/她/那人"指代），使用上面列出的**主名**。
   在 \`updatedCharacters\` 中仅提供**新增或变化**的字段（比如新的背景细节、性格侧面）。
2. **新角色**放在 \`newCharacters\`，完整填写所有字段。**特别注意**：如果本片段出现了之前片段未识别到的视角人物/主角（第一人称"我"或代称"他/她"），务必作为新角色添加；若无名字用"主角"作为 name。
3. **新地点**放在 \`newLocations\`；已知地点不必重复。
4. **keyEvents**：本片段发生的关键事件，\`involvedCharacters\` 里的名字必须使用主名（已知）或新角色名。
5. **worldSetting**：只填本片段**新发现或矛盾**的规则/时代/风格信息，其他留空。
6. **summary** 和 **timelineDescription**：只描述本片段内容。

必须返回严格JSON，不要其他文字：

{
  "summary": "本片段梗概",
  "worldSetting": { "era": "", "genre": "", "rules": [], "toneDescription": "" },
  "updatedCharacters": [
    { "name": "使用主名", "description": "（补充新信息）", "personality": "", "background": "",
      "relationships": [{ "targetName": "", "relation": "" }] }
  ],
  "newCharacters": [ /* 同 updatedCharacters 但是新角色，全部字段必填 */ ],
  "newLocations": [ { "name": "", "description": "" } ],
  "keyEvents": [ { "title": "", "description": "", "timeIndex": 0, "involvedCharacters": [], "locationName": "" } ],
  "timelineDescription": "本片段时间线"
}`;
}

const POLISH_SYSTEM_PROMPT = `你收到一份整合后的故事图谱（角色/地点/事件/世界观），基于它生成统一的叙事级信息。
返回严格JSON：
{
  "title": "故事统一标题",
  "summary": "整体故事梗概（200-400字，流畅连贯）",
  "toneDescription": "整体叙事风格（一句话）",
  "timelineDescription": "完整时间线描述（按事件顺序串联的叙述）"
}
只返回JSON，不要其他文字。`;

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_MAX_CHARS) {
      if (current.length > 0) { chunks.push(current.trim()); current = ''; }
      if (para.length > CHUNK_MAX_CHARS) {
        for (let i = 0; i < para.length; i += CHUNK_MAX_CHARS) {
          chunks.push(para.slice(i, i + CHUNK_MAX_CHARS));
        }
        continue;
      }
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function extractJSON(response: string): string {
  const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : response.trim();
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function snapshotCacheKey(fullTextHash: string, modelId: string, chunkIndex: number): string {
  return `${CACHE_PREFIX}${PROMPT_VERSION}:${modelId}:${fullTextHash}:${chunkIndex}`;
}

function readSnapshot(key: string): Graph | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSnapshot(key: string, graph: Graph): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(graph)); }
  catch { /* quota exceeded; parsing still works */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  onRetry?: (attempt: number, err: unknown) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (a === attempts - 1) break;
      onRetry?.(a + 1, err);
      const delay = [500, 2000, 5000][a] ?? 5000;
      await sleep(delay);
    }
  }
  throw lastErr;
}

// -----------------------------------------------------------------------------
// Graph operations
// -----------------------------------------------------------------------------

function emptyGraph(): Graph {
  return {
    worldSetting: { era: '', genre: '', rules: [], toneDescription: '' },
    characters: [],
    locations: [],
    keyEvents: [],
  };
}

/** Deeply clone a graph so snapshot cache is isolated from live state */
function cloneGraph(g: Graph): Graph {
  return JSON.parse(JSON.stringify(g));
}

/**
 * Merge a freshly parsed chunk result into the accumulated graph in-place.
 * Returns the same graph reference.
 */
function applyChunkUpdate(graph: Graph, chunk: ChunkParseResult, chunkIndex: number): Graph {
  // worldSetting: fill empty fields, union rules
  if (chunk.worldSetting) {
    if (!graph.worldSetting.era && chunk.worldSetting.era) graph.worldSetting.era = chunk.worldSetting.era;
    if (!graph.worldSetting.genre && chunk.worldSetting.genre) graph.worldSetting.genre = chunk.worldSetting.genre;
    if (!graph.worldSetting.toneDescription && chunk.worldSetting.toneDescription)
      graph.worldSetting.toneDescription = chunk.worldSetting.toneDescription;
    if (chunk.worldSetting.rules) {
      const existing = new Set(graph.worldSetting.rules || []);
      for (const r of chunk.worldSetting.rules) {
        const trimmed = r.trim();
        if (trimmed && !existing.has(trimmed)) {
          graph.worldSetting.rules = [...(graph.worldSetting.rules || []), trimmed];
          existing.add(trimmed);
        }
      }
    }
  }

  // Title: take first non-empty
  if (!graph.title && chunk.title) graph.title = chunk.title;

  // Characters: updates first, then new
  const byName = new Map(graph.characters.map(c => [c.name, c]));

  for (const upd of chunk.updatedCharacters || []) {
    const key = upd.name?.trim();
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      // LLM misclassified as update — treat as new
      graph.characters.push({
        name: key,
        description: upd.description || '',
        personality: upd.personality || '',
        background: upd.background || '',
        relationships: [...(upd.relationships || [])],
      });
      byName.set(key, graph.characters[graph.characters.length - 1]);
      continue;
    }
    // Extend fields with new information, not replace
    existing.description = appendDistinct(existing.description, upd.description);
    existing.personality = appendDistinct(existing.personality, upd.personality);
    existing.background = appendDistinct(existing.background, upd.background);
    // Relationships: dedup by targetName
    const relKey = new Set(existing.relationships?.map(r => r.targetName) || []);
    for (const r of upd.relationships || []) {
      if (r.targetName && !relKey.has(r.targetName)) {
        existing.relationships = [...(existing.relationships || []), r];
        relKey.add(r.targetName);
      }
    }
  }

  for (const c of chunk.newCharacters || []) {
    const key = c.name?.trim();
    if (!key) continue;
    if (byName.has(key)) {
      // LLM misclassified as new — treat as update
      const existing = byName.get(key)!;
      existing.description = appendDistinct(existing.description, c.description);
      existing.personality = appendDistinct(existing.personality, c.personality);
      existing.background = appendDistinct(existing.background, c.background);
      const relKey = new Set(existing.relationships?.map(r => r.targetName) || []);
      for (const r of c.relationships || []) {
        if (r.targetName && !relKey.has(r.targetName)) {
          existing.relationships = [...(existing.relationships || []), r];
          relKey.add(r.targetName);
        }
      }
    } else {
      graph.characters.push({
        name: key,
        description: c.description || '',
        personality: c.personality || '',
        background: c.background || '',
        relationships: [...(c.relationships || [])],
      });
      byName.set(key, graph.characters[graph.characters.length - 1]);
    }
  }

  // Locations: dedup by name, prefer longer description
  const locByName = new Map(graph.locations.map(l => [l.name, l]));
  for (const l of chunk.newLocations || []) {
    const key = l.name?.trim();
    if (!key) continue;
    const existing = locByName.get(key);
    if (!existing) {
      graph.locations.push({ name: key, description: l.description || '' });
      locByName.set(key, graph.locations[graph.locations.length - 1]);
    } else if ((l.description || '').length > (existing.description || '').length) {
      existing.description = l.description;
    }
  }

  // Events: append, dedup by title. Preserve chunk order via offset.
  const existingTitles = new Set(graph.keyEvents.map(e => e.title.trim()));
  for (const e of chunk.keyEvents || []) {
    if (!e.title) continue;
    const title = e.title.trim();
    if (existingTitles.has(title)) continue;
    const localIdx = e.timeIndex ?? 0;
    graph.keyEvents.push({
      ...e,
      title,
      timeIndex: chunkIndex * 10000 + localIdx,
    });
    existingTitles.add(title);
  }

  // Timeline + summary: append per-chunk descriptions (polished later)
  if (chunk.timelineDescription) {
    graph.timelineDescription = (graph.timelineDescription || '') +
      (graph.timelineDescription ? '\n\n' : '') + chunk.timelineDescription;
  }
  if (chunk.summary) {
    graph.summary = (graph.summary || '') +
      (graph.summary ? '\n\n' : '') + chunk.summary;
  }

  return graph;
}

function appendDistinct(existing: string | undefined, incoming: string | undefined): string {
  const e = (existing || '').trim();
  const i = (incoming || '').trim();
  if (!i) return e;
  if (!e) return i;
  if (e === i) return e;
  if (e.includes(i) || i.includes(e)) return e.length >= i.length ? e : i;
  return `${e}；${i}`;
}

// -----------------------------------------------------------------------------
// Per-chunk parse with cache + retry
// -----------------------------------------------------------------------------

/**
 * Heuristic estimate of bytes in the output JSON so we can drive a progress
 * bar from streamed character counts. Padded high so the bar moves under 1
 * even when the response is longer than average; we cap at 0.95 to leave room
 * for the "completion" jump.
 */
const EXPECTED_OUTPUT_CHARS = 2200;

async function parseChunkIncremental(
  config: LLMConfig,
  chunk: string,
  chunkIndex: number,
  total: number,
  graph: Graph,
  onChunkProgress?: (fraction: number) => void,
  onRetry?: (attempt: number) => void,
): Promise<ChunkParseResult> {
  const systemPrompt = chunkIndex === 0
    ? INITIAL_PARSE_PROMPT
    : buildIncrementalPrompt(graph);

  const userMessage = total > 1
    ? `（这是第 ${chunkIndex + 1}/${total} 段）\n\n${chunk}`
    : chunk;

  const maxTokens = chunkIndex === 0 && total === 1 ? 8192 : 4096;

  return withRetry(async () => {
    let full = '';
    let lastReported = 0;
    for await (const token of streamLLMBrowser(
      config, systemPrompt, userMessage,
      { temperature: 0.3, maxTokens },
    )) {
      full += token;
      // Throttle callbacks: emit at most every 40 chars to avoid 100s of
      // React renders per chunk.
      if (full.length - lastReported >= 40) {
        lastReported = full.length;
        const frac = Math.min(0.95, full.length / EXPECTED_OUTPUT_CHARS);
        onChunkProgress?.(frac);
      }
    }
    onChunkProgress?.(0.98);
    return JSON.parse(extractJSON(full)) as ChunkParseResult;
  }, MAX_RETRIES, (attempt) => onRetry?.(attempt));
}

/**
 * Normalize the first chunk's result format (INITIAL prompt returns
 * `characters` at top level, incremental prompt returns `newCharacters` +
 * `updatedCharacters`). Map initial → incremental shape.
 */
function normalizeFirstChunk(raw: ChunkParseResult & { characters?: RawCharacter[]; locations?: RawLocation[] }): ChunkParseResult {
  return {
    title: raw.title,
    summary: raw.summary,
    worldSetting: raw.worldSetting,
    newCharacters: raw.characters || raw.newCharacters || [],
    updatedCharacters: [],
    newLocations: raw.locations || raw.newLocations || [],
    keyEvents: raw.keyEvents || [],
    timelineDescription: raw.timelineDescription,
  };
}

// -----------------------------------------------------------------------------
// Main entry
// -----------------------------------------------------------------------------

export async function parseStoryClient(
  config: LLMConfig,
  storyText: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedStory> {
  const chunks = splitIntoChunks(storyText);
  const total = chunks.length;
  onProgress?.({ phase: 'split', current: 0, total });

  const fullTextHash = await sha256(storyText);
  const modelId = config.model || 'default';

  // Resume: find highest cached snapshot and start from there.
  let graph: Graph = emptyGraph();
  let startIndex = 0;
  let resumedFrom: number | undefined;
  for (let i = total - 1; i >= 0; i--) {
    const snap = readSnapshot(snapshotCacheKey(fullTextHash, modelId, i));
    if (snap) {
      graph = snap;
      startIndex = i + 1;
      resumedFrom = i + 1;
      break;
    }
  }

  onProgress?.({
    phase: 'parse', current: startIndex, total,
    resumedFrom, characters: graph.characters.length,
  });

  for (let i = startIndex; i < total; i++) {
    const chunkResult = await parseChunkIncremental(
      config, chunks[i], i, total, graph,
      (frac) => onProgress?.({
        phase: 'parse', current: i + frac, total,
        resumedFrom, characters: graph.characters.length,
      }),
      (attempt) => onProgress?.({
        phase: 'parse', current: i, total,
        resumedFrom, retrying: attempt, characters: graph.characters.length,
      }),
    );

    const normalized = i === 0 ? normalizeFirstChunk(chunkResult) : chunkResult;
    graph = applyChunkUpdate(graph, normalized, i);

    writeSnapshot(snapshotCacheKey(fullTextHash, modelId, i), cloneGraph(graph));

    onProgress?.({
      phase: 'parse', current: i + 1, total,
      resumedFrom, characters: graph.characters.length,
    });
  }

  // Sort events by accumulated timeIndex and renumber
  graph.keyEvents.sort((a, b) => (a.timeIndex ?? 0) - (b.timeIndex ?? 0));
  graph.keyEvents = graph.keyEvents.map((e, i) => ({ ...e, timeIndex: i }));

  // Polish: unified title/summary/timeline from the final graph. Skip for single-chunk
  // stories (they already have coherent text from the initial prompt).
  if (total > 1) {
    onProgress?.({ phase: 'polish', current: 0, total: 1 });
    try {
      const outline = JSON.stringify({
        workingTitle: graph.title,
        worldSetting: graph.worldSetting,
        characters: graph.characters.slice(0, 30).map(c => ({
          name: c.name, role: c.description?.slice(0, 80),
        })),
        keyEvents: graph.keyEvents.map(e => ({
          title: e.title, description: e.description?.slice(0, 200),
        })),
      });
      const polishResponse = await withRetry(
        () => callLLMBrowser(config, POLISH_SYSTEM_PROMPT, outline, { temperature: 0.4, maxTokens: 2048 }),
        MAX_RETRIES,
      );
      const polished = JSON.parse(extractJSON(polishResponse));
      graph.title = polished.title || graph.title || '未命名故事';
      graph.summary = polished.summary || graph.summary;
      graph.timelineDescription = polished.timelineDescription || graph.timelineDescription;
      graph.worldSetting.toneDescription = polished.toneDescription || graph.worldSetting.toneDescription;
    } catch (err) {
      console.warn('Polish step failed, using accumulated graph as-is:', err);
    }
  }

  onProgress?.({ phase: 'build', current: 1, total: 1 });
  return buildParsedStory(graph, storyText);
}

/** Clear all incremental graph snapshots. */
export function clearChunkCache(): number {
  if (typeof window === 'undefined') return 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
  return keys.length;
}

function buildParsedStory(graph: Graph, originalText: string): ParsedStory {
  const storyId = uuid();

  const characters: Character[] = graph.characters.map(c => ({
    id: uuid(), name: c.name, description: c.description || '',
    personality: c.personality || '', background: c.background || '',
    relationships: [], isOriginal: true,
  }));

  const nameToId = new Map(characters.map(c => [c.name, c.id]));
  graph.characters.forEach((c, i) => {
    if (c.relationships) {
      characters[i].relationships = c.relationships
        .filter(r => nameToId.has(r.targetName))
        .map(r => ({ characterId: nameToId.get(r.targetName)!, relation: r.relation }));
    }
  });

  const locations: Location[] = graph.locations.map(l => ({
    id: uuid(), name: l.name, description: l.description || '',
  }));
  const locNameToId = new Map(locations.map(l => [l.name, l.id]));

  const keyEvents: KeyEvent[] = graph.keyEvents.map(e => ({
    id: uuid(), title: e.title, description: e.description, timeIndex: e.timeIndex ?? 0,
    involvedCharacterIds: (e.involvedCharacters || []).map(n => nameToId.get(n)).filter(Boolean) as string[],
    locationId: e.locationName ? locNameToId.get(e.locationName) : undefined,
  }));

  const worldSetting: WorldSetting = {
    era: graph.worldSetting.era || '未知',
    genre: graph.worldSetting.genre || '未知',
    rules: graph.worldSetting.rules || [],
    toneDescription: graph.worldSetting.toneDescription || '',
  };

  return {
    id: storyId, title: graph.title || '未命名故事', originalText,
    summary: graph.summary || '', worldSetting, characters, locations, keyEvents,
    timelineDescription: graph.timelineDescription || '',
  };
}
