/**
 * 持久化分层：
 *
 *  - localStorage（同步、启动可立即读到）：仅 LLMConfig，约几百字节
 *  - IndexedDB（异步、容量百 MB 起步）：ParsedStory（含 30 万字原文）、
 *    GameSave（含完整 narrativeHistory / characterInteractions）
 *
 *  分流的目的：
 *    1. 摆脱 localStorage 5-10MB 硬上限，长篇小说也塞得下
 *    2. JSON.stringify 大对象不再阻塞主线程（IDB 把序列化挪到 worker）
 *    3. 写入按 key 独立，单条存档变化不会重写整个数组
 *
 *  对启动路径的影响：组件首屏拿不到 ParsedStory / GameSave，需要 useEffect
 *  异步加载。但 LLMConfig 仍是同步的，登录态校验之类的逻辑不受影响。
 */

import { createStore, get, set as idbSet, del, keys, values } from 'idb-keyval';
import {
  GameSave, LLMConfig, ParsedStory,
  RuntimeMemory, StateDelta,
} from './types';

// NOTE: app was renamed "AI TokTok" → "In The Book", but localStorage /
// IndexedDB names below intentionally keep the old `ai-toktok-*` identifiers
// so existing users' configs and saves remain readable. Renaming would
// silently strand all prior data.
const CONFIG_KEY = 'ai-toktok-config';

// ONE DATABASE PER STORE — idb-keyval's createStore opens the database
// versionless and creates only its own object store in the very first
// upgrade. Multiple createStore calls on the SAME database therefore leave
// every store except the first-ever-used one nonexistent, and all their
// reads/writes reject with NotFoundError. That exact bug shipped here as a
// single shared 'ai-toktok' DB: story bodies silently never persisted, and
// "继续" on a save died on loadStory. Data from the old shared DB is pulled
// over by migrateSharedDbStorage() below.
const LEGACY_SHARED_DB = 'ai-toktok';
const STORIES_STORE = 'stories';
const SAVES_STORE = 'saves';
// State_updater (Phase 5) writes per-turn delta + per-agent memory entries
// here. Other dialogue-runtime tables (agents/scenes/messages) are created
// lazily by their consumers when those paths come online.
const RUNTIME_MEMORY_STORE = 'runtimeMemory';
const STATE_DELTAS_STORE = 'stateDeltas';

const storiesDB = typeof window !== 'undefined'
  ? createStore('ai-toktok-stories', STORIES_STORE)
  : null!;
const savesDB = typeof window !== 'undefined'
  ? createStore('ai-toktok-saves', SAVES_STORE)
  : null!;
const runtimeMemoryDB = typeof window !== 'undefined'
  ? createStore('ai-toktok-runtime-memory', RUNTIME_MEMORY_STORE)
  : null!;
const stateDeltasDB = typeof window !== 'undefined'
  ? createStore('ai-toktok-state-deltas', STATE_DELTAS_STORE)
  : null!;

// =============================================================================
// LLMConfig — synchronous localStorage
// =============================================================================

export function saveLLMConfig(config: LLMConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function loadLLMConfig(): LLMConfig | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[storage] loadLLMConfig: corrupt JSON, clearing entry.', err);
    localStorage.removeItem(CONFIG_KEY);
    return null;
  }
}

// =============================================================================
// Stories — IndexedDB (object store keyed by story.id)
// =============================================================================

export async function saveStory(story: ParsedStory): Promise<void> {
  if (typeof window === 'undefined') return;
  await idbSet(story.id, story, storiesDB);
}

export async function loadStory(storyId: string): Promise<ParsedStory | null> {
  if (typeof window === 'undefined') return null;
  const story = await get<ParsedStory>(storyId, storiesDB);
  return story ?? null;
}

export async function loadAllStories(): Promise<ParsedStory[]> {
  if (typeof window === 'undefined') return [];
  return await values<ParsedStory>(storiesDB);
}

export async function deleteStory(storyId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  await del(storyId, storiesDB);
}

// =============================================================================
// Saves — IndexedDB (object store keyed by save.id)
// =============================================================================

export async function saveSave(save: GameSave): Promise<void> {
  if (typeof window === 'undefined') return;
  await idbSet(save.id, save, savesDB);
}

export async function loadSave(saveId: string): Promise<GameSave | null> {
  if (typeof window === 'undefined') return null;
  const save = await get<GameSave>(saveId, savesDB);
  return save ?? null;
}

export async function loadAllSaves(): Promise<GameSave[]> {
  if (typeof window === 'undefined') return [];
  const all = await values<GameSave>(savesDB);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSave(saveId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  await del(saveId, savesDB);
}

// =============================================================================
// One-time migration: pull legacy localStorage payloads into IndexedDB.
// Runs at most once per origin (success marker stored in localStorage).
// =============================================================================

const LEGACY_SAVES_KEY = 'ai-toktok-saves';
const LEGACY_STORIES_KEY = 'ai-toktok-stories';
const MIGRATED_KEY = 'ai-toktok-idb-migrated';
const SPLIT_MIGRATED_KEY = 'ai-toktok-idb-split-migrated';

/** Read every key/value pair out of one object store via cursor. */
function readAllRows(db: IDBDatabase, store: string): Promise<[IDBValidKey, unknown][]> {
  return new Promise((resolve, reject) => {
    const out: [IDBValidKey, unknown][] = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { out.push([cur.key, cur.value]); cur.continue(); }
      else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-time copy from the old SHARED 'ai-toktok' database into the new
 * one-DB-per-store layout. The shared DB only ever contained whichever
 * single store happened to be created first (see the createStore note
 * above), so we inspect objectStoreNames and copy what actually exists.
 * The old DB is left in place as a safety net.
 */
async function migrateSharedDbStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(SPLIT_MIGRATED_KEY)) return;

  try {
    // Don't create the legacy DB just by probing for it.
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      if (!dbs.some(d => d.name === LEGACY_SHARED_DB)) {
        localStorage.setItem(SPLIT_MIGRATED_KEY, '1');
        return;
      }
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(LEGACY_SHARED_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // If the DB didn't exist (browsers without indexedDB.databases),
      // this open creates an empty shell — objectStoreNames will be empty
      // and the loop below is a no-op.
      req.onupgradeneeded = () => { /* add no stores */ };
    });

    const targets: [string, typeof storiesDB][] = [
      [STORIES_STORE, storiesDB],
      [SAVES_STORE, savesDB],
      [RUNTIME_MEMORY_STORE, runtimeMemoryDB],
      [STATE_DELTAS_STORE, stateDeltasDB],
    ];
    for (const [storeName, target] of targets) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      const rows = await readAllRows(db, storeName);
      for (const [key, value] of rows) {
        await idbSet(key, value, target);
      }
      if (rows.length > 0) {
        console.info(`[storage] migrated ${rows.length} rows from shared DB store "${storeName}"`);
      }
    }
    db.close();
    localStorage.setItem(SPLIT_MIGRATED_KEY, '1');
  } catch (err) {
    console.warn('[storage] shared-DB split migration failed; will retry next launch.', err);
  }
}

export async function migrateLegacyStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  // Phase 0: shared-DB → per-store DBs (runs even for users who already did
  // the localStorage→IDB migration below — separate marker).
  await migrateSharedDbStorage();
  if (localStorage.getItem(MIGRATED_KEY)) return;

  try {
    const rawStories = localStorage.getItem(LEGACY_STORIES_KEY);
    if (rawStories) {
      const stories: ParsedStory[] = JSON.parse(rawStories);
      const existing = new Set(await keys(storiesDB));
      for (const s of stories) {
        if (!existing.has(s.id)) await idbSet(s.id, s, storiesDB);
      }
      localStorage.removeItem(LEGACY_STORIES_KEY);
    }

    const rawSaves = localStorage.getItem(LEGACY_SAVES_KEY);
    if (rawSaves) {
      const saves: GameSave[] = JSON.parse(rawSaves);
      const existing = new Set(await keys(savesDB));
      for (const s of saves) {
        if (!existing.has(s.id)) await idbSet(s.id, s, savesDB);
      }
      localStorage.removeItem(LEGACY_SAVES_KEY);
    }

    localStorage.setItem(MIGRATED_KEY, '1');
  } catch (err) {
    console.warn('Legacy storage migration failed; will retry next launch.', err);
  }
}

// =============================================================================
// Phase 5 runtime: per-turn StateDelta + per-agent RuntimeMemory.
// Only the writers ship for now; readers will land alongside the future
// reflection / debug-panel code that consumes them.
// =============================================================================

export async function saveRuntimeMemory(mem: RuntimeMemory): Promise<void> {
  if (typeof window === 'undefined') return;
  await idbSet(mem.id, mem, runtimeMemoryDB);
}

export async function saveStateDelta(delta: StateDelta): Promise<void> {
  if (typeof window === 'undefined') return;
  await idbSet(delta.id, delta, stateDeltasDB);
}
