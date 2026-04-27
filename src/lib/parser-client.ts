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

import { createStore, get as idbGet, set as idbSet, keys as idbKeys, clear as idbClear } from 'idb-keyval';
import { callLLMBrowser, streamLLMBrowser } from './llm-browser';
import { stripThinking, extractFirstBalancedJSON } from './narrator-browser';
import { logEvent } from './telemetry';
import {
  INITIAL_PARSE_PROMPT,
  buildIncrementalPrompt,
  POLISH_SYSTEM_PROMPT,
} from './prompts';
import {
  LLMConfig, ParsedStory, Character, Location, KeyEvent, WorldSetting,
  WorldEntity, Faction, Relationship, LoreEntry, TimelineEvent, IPProject,
} from './types';
import { v4 as uuid } from 'uuid';

const CHUNK_MAX_CHARS = 24000;
const MAX_RETRIES = 3;
// Bump PROMPT_VERSION whenever the extraction prompt's expected output shape
// changes — the snapshot cache key embeds it, so old in-progress runs are
// not resumed against a new schema. v5 added factions / loreEntries /
// conflicts / event causes & consequences (Phase 2).
const PROMPT_VERSION = '5';
const CACHE_PREFIX = 'ai-toktok-graph-cache:';
const CACHE_DB = 'ai-toktok';
const CACHE_STORE = 'graphCache';

// In Node (build-preset script) we transparently fall back to no caching, just
// like the legacy localStorage path did. `idb-keyval` requires `indexedDB`
// which Node doesn't ship.
const cacheDB = typeof indexedDB !== 'undefined'
  ? createStore(CACHE_DB, CACHE_STORE)
  : null;

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
  causes?: string[]; consequences?: string[];
};
type RawFaction = {
  name: string; description?: string; ideology?: string;
  members?: string[]; rivals?: string[];
};
type RawLoreEntry = {
  title: string; content: string; tags?: string[];
  relatedNames?: string[]; importance?: number;
};
type RawConflict = {
  title: string; description?: string; involvedNames?: string[];
  stage?: string; intensity?: number;
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
  factions: RawFaction[];
  loreEntries: RawLoreEntry[];
  conflicts: RawConflict[];
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
  newFactions?: RawFaction[];
  newLoreEntries?: RawLoreEntry[];
  newConflicts?: RawConflict[];
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

// Prompts live in src/lib/prompts/world-extraction.ts. They are imported above.

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

/**
 * Pull a parseable JSON document out of an LLM response.
 *
 * Strategy (in order): drop any reasoning-model `<think>` preamble, honour
 * an explicit ```json fence if present, otherwise grab the first balanced
 * JSON object/array in the cleaned buffer, otherwise fall back to the
 * cleaned-trimmed string. Handles DeepSeek-R1 / MiniMax-M2 / Qwen-reasoning
 * outputs where the thought process is mixed into the primary content.
 */
function extractJSON(response: string): string {
  const cleaned = stripThinking(response);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const balanced = extractFirstBalancedJSON(cleaned);
  if (balanced) return balanced;
  return cleaned.trim();
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

async function readSnapshot(key: string): Promise<Graph | null> {
  if (!cacheDB) return null;
  try {
    const snap = await idbGet<Graph>(key, cacheDB);
    return snap ?? null;
  } catch { return null; }
}

async function writeSnapshot(key: string, graph: Graph): Promise<void> {
  if (!cacheDB) return;
  try { await idbSet(key, graph, cacheDB); }
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
    factions: [],
    loreEntries: [],
    conflicts: [],
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
      causes: e.causes || [],
      consequences: e.consequences || [],
    });
    existingTitles.add(title);
  }

  // Factions: dedup by name; merge member/rival lists.
  const factionByName = new Map(graph.factions.map(f => [f.name, f]));
  for (const f of chunk.newFactions || []) {
    const key = f.name?.trim();
    if (!key) continue;
    const existing = factionByName.get(key);
    if (!existing) {
      graph.factions.push({
        name: key,
        description: f.description || '',
        ideology: f.ideology || '',
        members: [...(f.members || [])],
        rivals: [...(f.rivals || [])],
      });
      factionByName.set(key, graph.factions[graph.factions.length - 1]);
    } else {
      existing.description = appendDistinct(existing.description, f.description);
      existing.ideology = appendDistinct(existing.ideology, f.ideology);
      const memberSet = new Set(existing.members || []);
      for (const m of f.members || []) {
        if (m && !memberSet.has(m)) {
          existing.members = [...(existing.members || []), m];
          memberSet.add(m);
        }
      }
      const rivalSet = new Set(existing.rivals || []);
      for (const r of f.rivals || []) {
        if (r && !rivalSet.has(r)) {
          existing.rivals = [...(existing.rivals || []), r];
          rivalSet.add(r);
        }
      }
    }
  }

  // Lore entries: dedup by title; later entries with longer content win.
  const loreByTitle = new Map(graph.loreEntries.map(l => [l.title, l]));
  for (const l of chunk.newLoreEntries || []) {
    const key = l.title?.trim();
    if (!key || !l.content) continue;
    const existing = loreByTitle.get(key);
    if (!existing) {
      graph.loreEntries.push({
        title: key,
        content: l.content,
        tags: [...(l.tags || [])],
        relatedNames: [...(l.relatedNames || [])],
        importance: typeof l.importance === 'number' ? l.importance : 3,
      });
      loreByTitle.set(key, graph.loreEntries[graph.loreEntries.length - 1]);
    } else if ((l.content || '').length > (existing.content || '').length) {
      existing.content = l.content;
    }
  }

  // Conflicts: dedup by title; later stages override (story progresses).
  const conflictByTitle = new Map(graph.conflicts.map(c => [c.title, c]));
  for (const c of chunk.newConflicts || []) {
    const key = c.title?.trim();
    if (!key) continue;
    const existing = conflictByTitle.get(key);
    if (!existing) {
      graph.conflicts.push({
        title: key,
        description: c.description || '',
        involvedNames: [...(c.involvedNames || [])],
        stage: c.stage || 'latent',
        intensity: typeof c.intensity === 'number' ? c.intensity : 0,
      });
      conflictByTitle.set(key, graph.conflicts[graph.conflicts.length - 1]);
    } else {
      // Stage progression: later chunks reflect later story state.
      if (c.stage) existing.stage = c.stage;
      if (typeof c.intensity === 'number') existing.intensity = c.intensity;
      existing.description = appendDistinct(existing.description, c.description);
    }
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

  // Long novels (e.g. 三国演义 ~60 万字 / 26 片) routinely produce chunks with
  // 5-10 new named characters plus long event descriptions. 4096 tokens of
  // output truncates JSON mid-string, all 3 retries fail, and the entire parse
  // dies. 8192 gives safe headroom for any chunk size.
  const maxTokens = 8192;

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
    newFactions: raw.newFactions || [],
    newLoreEntries: raw.newLoreEntries || [],
    newConflicts: raw.newConflicts || [],
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
    const snap = await readSnapshot(snapshotCacheKey(fullTextHash, modelId, i));
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
    logEvent('parser.chunk_start', { chunkIndex: i, total });
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

    await writeSnapshot(snapshotCacheKey(fullTextHash, modelId, i), cloneGraph(graph));

    logEvent('parser.chunk_done', {
      chunkIndex: i,
      characters: graph.characters.length,
      locations: graph.locations.length,
      events: graph.keyEvents.length,
      factions: graph.factions.length,
      lore: graph.loreEntries.length,
    });

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
      logEvent('parser.error', { stage: 'polish', error: String(err) });
    }
    logEvent('parser.polish', { ok: true, title: graph.title });
  }

  onProgress?.({ phase: 'build', current: 1, total: 1 });
  return buildParsedStory(graph, storyText);
}

/** Clear all incremental graph snapshots. */
export async function clearChunkCache(): Promise<number> {
  if (!cacheDB) return 0;
  const all = await idbKeys(cacheDB);
  await idbClear(cacheDB);
  return all.length;
}

function buildParsedStory(graph: Graph, originalText: string): ParsedStory {
  const storyId = uuid();
  const projectId = storyId; // 1:1 with story for now; Phase 7 may decouple.

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

  // ---- Phase 2 derived tables (additive; legacy arrays above remain
  //      authoritative for runtime).
  const entities = buildEntities(projectId, graph, characters, locations, keyEvents);
  const relationships = buildRelationships(projectId, graph, nameToId);
  const factions = buildFactions(projectId, graph);
  const loreEntries = buildLorebook(projectId, graph, nameToId);
  const timelineEvents = buildTimeline(projectId, graph, keyEvents);
  const project: IPProject = {
    id: projectId,
    title: graph.title || '未命名故事',
    description: graph.summary || '',
    sourceType: 'paste',
    status: 'built',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    buildConfig: {},
  };

  return {
    id: storyId, title: graph.title || '未命名故事', originalText,
    summary: graph.summary || '', worldSetting, characters, locations, keyEvents,
    timelineDescription: graph.timelineDescription || '',
    project, entities, relationships, factions, loreEntries, timelineEvents,
  };
}

// =============================================================================
// Phase 2 · Derived-table builders
// =============================================================================

/**
 * Lift the legacy arrays + factions into a unified WorldEntity table.
 * Each character/location/event/faction gets one record, importance scored
 * heuristically (mention count for characters, raw length for descriptions).
 */
function buildEntities(
  projectId: string,
  graph: Graph,
  characters: Character[],
  locations: Location[],
  keyEvents: KeyEvent[],
): WorldEntity[] {
  const entities: WorldEntity[] = [];
  for (const c of characters) {
    entities.push({
      id: c.id, projectId, name: c.name, type: 'character',
      description: c.description,
      importance: scoreCharacterImportance(c, graph),
    });
  }
  for (const l of locations) {
    entities.push({
      id: l.id, projectId, name: l.name, type: 'location',
      description: l.description, importance: 2,
    });
  }
  for (const f of graph.factions) {
    entities.push({
      id: uuid(), projectId, name: f.name, type: 'faction',
      description: f.description || '', importance: 3,
    });
  }
  for (const e of keyEvents) {
    entities.push({
      id: e.id, projectId, name: e.title, type: 'event',
      description: e.description, importance: 3,
    });
  }
  return entities;
}

/**
 * Heuristic 1..5 importance score. Player-facing UI uses this to sort the
 * cast and to feed L0/L1 of the context injector in Phase 4.
 */
function scoreCharacterImportance(c: Character, graph: Graph): number {
  const eventCount = graph.keyEvents.filter(
    e => (e.involvedCharacters || []).includes(c.name),
  ).length;
  const score = 1
    + Math.min(2, eventCount)
    + (c.background && c.background.length > 80 ? 1 : 0)
    + ((c.relationships?.length || 0) >= 2 ? 1 : 0);
  return Math.max(1, Math.min(5, score));
}

/**
 * Top-level relationship table. Lifts each character.relationships[] entry
 * into a directed Relationship record. Polarity is initially 0 (neutral);
 * Phase 5 StateDelta application updates it during play.
 */
function buildRelationships(
  projectId: string,
  graph: Graph,
  nameToId: Map<string, string>,
): Relationship[] {
  const out: Relationship[] = [];
  for (const c of graph.characters) {
    const sourceId = nameToId.get(c.name);
    if (!sourceId || !c.relationships) continue;
    for (const r of c.relationships) {
      const targetId = nameToId.get(r.targetName);
      if (!targetId) continue;
      out.push({
        id: uuid(), projectId,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relationType: r.relation,
        polarity: 0,
        strength: 0.5,
      });
    }
  }
  return out;
}

function buildFactions(projectId: string, graph: Graph): Faction[] {
  return graph.factions.map(f => ({
    id: uuid(), projectId,
    name: f.name,
    description: f.description || '',
    ideology: f.ideology || '',
    memberEntityIds: [],   // names → ids resolved later if needed
    rivals: f.rivals || [],
  }));
}

/**
 * Build the lorebook. Sources:
 *   1. Each `worldSetting.rules[]` becomes a high-importance LoreEntry.
 *   2. Each LLM-emitted `loreEntries[]` is taken verbatim.
 *   3. Each faction description becomes a medium-importance entry.
 *
 * `triggerKeywords` are auto-derived from the title + any related names so
 * the L4 keyword scanner (Phase 4) can re-introduce the entry on demand.
 */
function buildLorebook(
  projectId: string,
  graph: Graph,
  nameToId: Map<string, string>,
): LoreEntry[] {
  const out: LoreEntry[] = [];

  for (const rule of graph.worldSetting.rules || []) {
    if (!rule.trim()) continue;
    out.push({
      id: uuid(), projectId,
      title: rule.length > 16 ? rule.slice(0, 16) + '…' : rule,
      content: rule,
      importance: 5,
      triggerKeywords: deriveKeywords(rule),
    });
  }

  for (const l of graph.loreEntries) {
    const relatedIds = (l.relatedNames || [])
      .map(n => nameToId.get(n))
      .filter((id): id is string => Boolean(id));
    out.push({
      id: uuid(), projectId,
      title: l.title,
      content: l.content,
      tags: l.tags || [],
      relatedEntityIds: relatedIds,
      importance: typeof l.importance === 'number' ? l.importance : 3,
      triggerKeywords: deriveKeywords(l.title, l.relatedNames || [], l.tags || []),
    });
  }

  for (const f of graph.factions) {
    if (!f.description) continue;
    out.push({
      id: uuid(), projectId,
      title: f.name,
      content: `${f.name}：${f.description}${f.ideology ? `。理念：${f.ideology}` : ''}`,
      importance: 3,
      triggerKeywords: [f.name, ...(f.members || []), ...(f.rivals || [])],
    });
  }

  return out;
}

/**
 * Pull the keyword set the L4 scanner uses to re-trigger this lore entry.
 * Falls back to the title token itself when no extras are supplied.
 */
function deriveKeywords(title: string, ...extras: (string[] | string)[]): string[] {
  const set = new Set<string>();
  if (title) set.add(title.trim());
  for (const e of extras) {
    if (Array.isArray(e)) for (const v of e) { if (v) set.add(v); }
    else if (e) set.add(e);
  }
  return [...set].filter(Boolean);
}

/**
 * Build the causal TimelineEvent table from the legacy keyEvents +
 * LLM-emitted causes/consequences. Order is the timeIndex assigned during
 * merge (chunkIndex * 10000 + localIndex), then renumbered on flatten.
 */
function buildTimeline(
  projectId: string,
  graph: Graph,
  keyEvents: KeyEvent[],
): TimelineEvent[] {
  const idToKE = new Map(keyEvents.map(e => [e.title, e.id]));
  return graph.keyEvents.map((e, idx) => ({
    id: idToKE.get(e.title) || uuid(),
    projectId,
    title: e.title,
    description: e.description,
    orderIndex: idx,
    participants: e.involvedCharacters || [],
    locations: e.locationName ? [e.locationName] : [],
    causes: e.causes || [],
    consequences: e.consequences || [],
  }));
}
