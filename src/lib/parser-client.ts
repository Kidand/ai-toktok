/** 客户端直接调用 LLM 解析故事（绕过 Next.js API 超时） */

import { callLLMBrowser } from './llm-browser';
import { LLMConfig, ParsedStory, Character, Location, KeyEvent, WorldSetting } from './types';
import { v4 as uuid } from 'uuid';

const CHUNK_MAX_CHARS = 24000;
const CONCURRENCY = 4;
const MAX_RETRIES = 3;
const PROMPT_VERSION = '2'; // bump to invalidate chunk cache
const CACHE_PREFIX = 'ai-toktok-chunk-cache:';

const PARSE_SYSTEM_PROMPT = `你是一个专业的故事分析AI。你的任务是深度解析用户提供的故事文本片段，提取所有关键信息。

你必须以严格的JSON格式返回分析结果，不要包含任何其他文字。JSON结构如下：

{
  "title": "故事标题（如果文本中没有明确标题，请根据内容生成一个合适的标题）",
  "summary": "本片段梗概（100-200字）",
  "worldSetting": {
    "era": "时代背景描述",
    "genre": "故事类型",
    "rules": ["世界规则1", "世界规则2"],
    "toneDescription": "叙事风格描述"
  },
  "characters": [
    {
      "name": "角色名",
      "description": "外貌及身份简述",
      "personality": "性格特征详述",
      "background": "背景故事",
      "relationships": [
        { "targetName": "关联角色名", "relation": "关系描述" }
      ]
    }
  ],
  "locations": [
    { "name": "地点名", "description": "地点描述" }
  ],
  "keyEvents": [
    {
      "title": "事件标题",
      "description": "事件描述",
      "timeIndex": 0,
      "involvedCharacters": ["角色名1", "角色名2"],
      "locationName": "发生地点名"
    }
  ],
  "timelineDescription": "本片段时间线描述"
}

注意：提取所有有名字的角色，关键事件按时间顺序排列。`;

const POLISH_SYSTEM_PROMPT = `你将收到一份已经结构化的故事信息（角色/地点/事件），请基于它生成统一的整体信息。

返回严格JSON：
{
  "title": "故事统一标题",
  "summary": "整体故事梗概（200-400字，流畅连贯）",
  "toneDescription": "整体叙事风格（一句话）",
  "timelineDescription": "完整时间线描述（按事件顺序串联成叙述）"
}

只返回JSON，不要其他文字。`;

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
type ChunkResult = {
  title?: string;
  summary?: string;
  worldSetting?: RawWorldSetting;
  characters?: RawCharacter[];
  locations?: RawLocation[];
  keyEvents?: RawEvent[];
  timelineDescription?: string;
};

export type ParseProgress = {
  phase: 'split' | 'parse' | 'merge' | 'polish' | 'build';
  current: number;
  total: number;
  cached?: number;  // chunks served from cache
  retrying?: number; // chunk index currently retrying
};

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
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function cacheKey(chunkHash: string, modelId: string): string {
  return `${CACHE_PREFIX}${PROMPT_VERSION}:${modelId}:${chunkHash}`;
}

function readCache(key: string): ChunkResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(key: string, value: ChunkResult): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* quota exceeded — ignore, parsing still works */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run fn over items with bounded concurrency. Preserves result order.
 * Fails fast if any item errors after its retries exhaust.
 */
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
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
// Per-chunk parse (with cache + retry)
// -----------------------------------------------------------------------------

async function parseChunk(
  config: LLMConfig,
  chunk: string,
  chunkHash: string,
  chunkIndex: number,
  total: number,
  onRetry?: (attempt: number) => void,
): Promise<{ result: ChunkResult; fromCache: boolean }> {
  const key = cacheKey(chunkHash, config.model || 'default');
  const cached = readCache(key);
  if (cached) return { result: cached, fromCache: true };

  const result = await withRetry(async () => {
    const prefix = total > 1 ? `（这是第 ${chunkIndex + 1}/${total} 段）\n\n` : '';
    const response = await callLLMBrowser(
      config, PARSE_SYSTEM_PROMPT,
      `${prefix}请解析以下故事文本${total > 1 ? '片段' : ''}：\n\n${chunk}`,
      { temperature: 0.3, maxTokens: total > 1 ? 4096 : 8192 },
    );
    return JSON.parse(extractJSON(response)) as ChunkResult;
  }, MAX_RETRIES, (attempt) => onRetry?.(attempt));

  writeCache(key, result);
  return { result, fromCache: false };
}

// -----------------------------------------------------------------------------
// Deterministic merge of chunk results
// -----------------------------------------------------------------------------

function mergeCharacters(chunks: ChunkResult[]): RawCharacter[] {
  const byName = new Map<string, RawCharacter>();
  for (const chunk of chunks) {
    for (const c of chunk.characters || []) {
      if (!c.name) continue;
      const key = c.name.trim();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, {
          name: key,
          description: c.description || '',
          personality: c.personality || '',
          background: c.background || '',
          relationships: [...(c.relationships || [])],
        });
      } else {
        // Prefer longer, more detailed strings
        if ((c.description || '').length > (existing.description || '').length) existing.description = c.description;
        if ((c.personality || '').length > (existing.personality || '').length) existing.personality = c.personality;
        if ((c.background || '').length > (existing.background || '').length) existing.background = c.background;
        // Merge relationships (dedup by targetName)
        const relKey = new Set(existing.relationships?.map(r => r.targetName) || []);
        for (const r of c.relationships || []) {
          if (!relKey.has(r.targetName)) {
            existing.relationships = [...(existing.relationships || []), r];
            relKey.add(r.targetName);
          }
        }
      }
    }
  }
  return [...byName.values()];
}

function mergeLocations(chunks: ChunkResult[]): RawLocation[] {
  const byName = new Map<string, RawLocation>();
  for (const chunk of chunks) {
    for (const l of chunk.locations || []) {
      if (!l.name) continue;
      const key = l.name.trim();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { name: key, description: l.description || '' });
      } else if ((l.description || '').length > (existing.description || '').length) {
        existing.description = l.description;
      }
    }
  }
  return [...byName.values()];
}

function mergeEvents(chunks: ChunkResult[]): RawEvent[] {
  const all: RawEvent[] = [];
  chunks.forEach((chunk, chunkIdx) => {
    for (const e of chunk.keyEvents || []) {
      if (!e.title) continue;
      // offset timeIndex by chunk position × 1000 so chunk order is preserved
      // while intra-chunk order is kept
      const localIdx = e.timeIndex ?? 0;
      all.push({ ...e, timeIndex: chunkIdx * 1000 + localIdx });
    }
  });
  // Dedup by title — keep earliest occurrence
  const seen = new Set<string>();
  const deduped = all.filter(e => {
    const key = e.title.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Sort by adjusted timeIndex, then renumber sequentially
  deduped.sort((a, b) => (a.timeIndex ?? 0) - (b.timeIndex ?? 0));
  return deduped.map((e, i) => ({ ...e, timeIndex: i }));
}

function mergeWorldSetting(chunks: ChunkResult[]): RawWorldSetting {
  const pick = (field: keyof RawWorldSetting): string => {
    for (const c of chunks) {
      const val = (c.worldSetting?.[field] as string | undefined) || '';
      if (val) return val;
    }
    return '';
  };
  const rules = new Set<string>();
  for (const c of chunks) {
    for (const r of c.worldSetting?.rules || []) rules.add(r.trim());
  }
  return {
    era: pick('era'),
    genre: pick('genre'),
    toneDescription: pick('toneDescription'),
    rules: [...rules],
  };
}

function mergeChunksDeterministic(chunks: ChunkResult[]): ChunkResult {
  // Title: first non-empty chunk title, or longest if all same length
  const title = chunks.map(c => c.title).find(t => t && t.trim()) || '未命名故事';
  const rawSummary = chunks.map(c => c.summary).filter(Boolean).join('\n\n');
  const rawTimeline = chunks.map(c => c.timelineDescription).filter(Boolean).join('\n\n');
  return {
    title,
    summary: rawSummary,
    worldSetting: mergeWorldSetting(chunks),
    characters: mergeCharacters(chunks),
    locations: mergeLocations(chunks),
    keyEvents: mergeEvents(chunks),
    timelineDescription: rawTimeline,
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

  // Hash all chunks in parallel
  const hashes = await Promise.all(chunks.map(sha256));

  // Parse with bounded concurrency + cache + retry
  let completed = 0;
  let cachedCount = 0;
  onProgress?.({ phase: 'parse', current: 0, total, cached: 0 });

  const chunkResults = await parallelMap(chunks, CONCURRENCY, async (chunk, i) => {
    const { result, fromCache } = await parseChunk(
      config, chunk, hashes[i], i, total,
      () => onProgress?.({ phase: 'parse', current: completed, total, cached: cachedCount, retrying: i + 1 }),
    );
    completed++;
    if (fromCache) cachedCount++;
    onProgress?.({ phase: 'parse', current: completed, total, cached: cachedCount });
    return result;
  });

  // Deterministic structural merge
  onProgress?.({ phase: 'merge', current: 0, total: 1 });
  const merged = total === 1 ? chunkResults[0] : mergeChunksDeterministic(chunkResults);

  // Polish prose via small LLM call — skip for single-chunk stories
  let finalResult: ChunkResult = merged;
  if (total > 1) {
    onProgress?.({ phase: 'polish', current: 0, total: 1 });
    try {
      const outline = JSON.stringify({
        title: merged.title,
        worldSetting: merged.worldSetting,
        characters: (merged.characters || []).slice(0, 30).map(c => ({ name: c.name, role: c.description })),
        keyEvents: (merged.keyEvents || []).map(e => ({ title: e.title, description: e.description })),
      });
      const polishResponse = await withRetry(
        () => callLLMBrowser(config, POLISH_SYSTEM_PROMPT, outline, { temperature: 0.4, maxTokens: 2048 }),
        MAX_RETRIES,
      );
      const polished = JSON.parse(extractJSON(polishResponse));
      finalResult = {
        ...merged,
        title: polished.title || merged.title,
        summary: polished.summary || merged.summary,
        timelineDescription: polished.timelineDescription || merged.timelineDescription,
        worldSetting: {
          ...merged.worldSetting,
          toneDescription: polished.toneDescription || merged.worldSetting?.toneDescription || '',
        },
      };
    } catch (err) {
      console.warn('Polish step failed, using deterministic merge result:', err);
      // Fallback: just use the deterministic merge — parsing still succeeds.
    }
  }

  onProgress?.({ phase: 'build', current: 1, total: 1 });
  return buildParsedStory(finalResult, storyText);
}

/**
 * Clear all cached chunk parses. Use when cache misbehaves or manually reset.
 */
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

function buildParsedStory(parsed: ChunkResult, originalText: string): ParsedStory {
  const storyId = uuid();

  const characters: Character[] = (parsed.characters || []).map(c => ({
    id: uuid(), name: c.name, description: c.description || '',
    personality: c.personality || '', background: c.background || '',
    relationships: [], isOriginal: true,
  }));

  const nameToId = new Map(characters.map(c => [c.name, c.id]));
  (parsed.characters || []).forEach((c, i) => {
    if (c.relationships) {
      characters[i].relationships = c.relationships
        .filter(r => nameToId.has(r.targetName))
        .map(r => ({ characterId: nameToId.get(r.targetName)!, relation: r.relation }));
    }
  });

  const locations: Location[] = (parsed.locations || []).map(l => ({
    id: uuid(), name: l.name, description: l.description || '',
  }));
  const locNameToId = new Map(locations.map(l => [l.name, l.id]));

  const keyEvents: KeyEvent[] = (parsed.keyEvents || []).map(e => ({
    id: uuid(), title: e.title, description: e.description, timeIndex: e.timeIndex ?? 0,
    involvedCharacterIds: (e.involvedCharacters || []).map(n => nameToId.get(n)).filter(Boolean) as string[],
    locationId: e.locationName ? locNameToId.get(e.locationName) : undefined,
  }));

  const worldSetting: WorldSetting = {
    era: parsed.worldSetting?.era || '未知',
    genre: parsed.worldSetting?.genre || '未知',
    rules: parsed.worldSetting?.rules || [],
    toneDescription: parsed.worldSetting?.toneDescription || '',
  };

  return {
    id: storyId, title: parsed.title || '未命名故事', originalText,
    summary: parsed.summary || '', worldSetting, characters, locations, keyEvents,
    timelineDescription: parsed.timelineDescription || '',
  };
}
