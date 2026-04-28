import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  GameState, InjectionConfig, LLMConfig, ParsedStory, PlayerConfig,
  GuardrailParams, NarrativeBalance, NarrativeEntry,
  CharacterInteraction, GameSave, EpilogueEntry, StoryArcReport,
} from '@/lib/types';
import {
  saveSave, loadSave, loadAllSaves, deleteSave,
  saveLLMConfig, loadLLMConfig,
  saveStory, loadStory,
  migrateLegacyStorage,
} from '@/lib/storage';
import { v4 as uuid } from 'uuid';

interface GameActions {
  // 配置
  setLLMConfig: (config: LLMConfig) => void;
  setParsedStory: (story: ParsedStory) => void;
  setPlayerConfig: (config: PlayerConfig) => void;
  setGuardrailParams: (params: Partial<GuardrailParams>) => void;
  setNarrativeBalance: (balance: Partial<NarrativeBalance>) => void;
  setInjectionConfig: (config: Partial<InjectionConfig>) => void;

  // 游戏控制
  startGame: () => void;
  setIsParsing: (v: boolean) => void;
  setIsGenerating: (v: boolean) => void;
  addNarrativeEntries: (entries: NarrativeEntry[]) => void;
  addPlayerAction: (input: string) => void;
  addCharacterInteractions: (interactions: CharacterInteraction[]) => void;

  // 存档
  autoSave: () => void;
  /**
   * Finish a playthrough. The result envelope carries both the
   * per-character `memoirs` and the optional 起承转合 `storyArc` recap.
   * `storyArc` is optional so legacy callers (or short playthroughs
   * where arc generation failed) still complete cleanly.
   */
  completeGame: (result: { memoirs: EpilogueEntry[]; storyArc?: StoryArcReport }) => void;
  loadSaves: () => Promise<void>;
  loadFromSave: (save: GameSave, story: ParsedStory) => void;
  removeSave: (saveId: string) => Promise<void>;

  // 重置
  resetGame: () => void;
  resetAll: () => void;

  // 初始化
  init: () => Promise<void>;
}

const defaultGuardrail: GuardrailParams = { temperature: 0.5, strictness: 0.6 };
const defaultBalance: NarrativeBalance = { narrativeWeight: 50 };
const defaultInjection: InjectionConfig = {
  mode: 'smart',
  windowSize: 5,
  expandDepth: 1,
  maxTriggered: 8,
};

const initialState: GameState = {
  llmConfig: null,
  parsedStory: null,
  playerConfig: null,
  guardrailParams: defaultGuardrail,
  narrativeBalance: defaultBalance,
  injectionConfig: defaultInjection,
  isPlaying: false,
  isParsing: false,
  isGenerating: false,
  narrativeHistory: [],
  characterInteractions: [],
  currentSaveId: null,
  saves: [],
  lastStoryId: null,
  // Default true — the store never blocks UI on async IDB. See the
  // GameState._hydrated comment in types.ts.
  _hydrated: true,
};

/**
 * Compose an updated saves list around a single mutated save, without
 * round-tripping IndexedDB. Keeps the array sorted by `updatedAt desc` to match
 * `loadAllSaves` ordering.
 */
function upsertSave(saves: GameSave[], save: GameSave): GameSave[] {
  const next = saves.filter(s => s.id !== save.id);
  next.push(save);
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next;
}

/**
 * Module-scope dedupe of `init()`. The very first call kicks off the IDB
 * hydration; later calls (e.g. play/epilogue page mounted via hard refresh
 * before the home page ran) get the same in-flight promise and don't restart
 * the work or briefly flip `_hydrated` back to false.
 */
let initPromise: Promise<void> | null = null;

/**
 * Hard upper bound on how long the UI is allowed to wait on IDB hydration
 * before the page falls through to its post-hydrate fallbacks. 8s is far
 * longer than a healthy hydrate (~50-200ms) but short enough that a
 * locked IDB transaction (other tab holding versionchange, etc.) doesn't
 * leave the user staring at "加载游戏中..." forever. After timeout we
 * still mark `_hydrated: true` so the page can render its empty-state.
 */
const INIT_WATCHDOG_MS = 8000;

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      init: () => {
        if (initPromise) return initPromise;
        initPromise = (async () => {
          // The actual hydration work — wrapped so a slow / stuck IDB
          // can't trap the UI in "加载游戏中..." forever, and so any
          // single failed step (corrupt save row, missing legacy key,
          // etc.) doesn't prevent later steps from running.
          const hydrate = async () => {
            try {
              const config = loadLLMConfig();
              set({
                llmConfig: config,
                isParsing: false,
                isGenerating: false,
              });
            } catch (err) {
              console.warn('[gameStore] loadLLMConfig failed', err);
            }

            try {
              await migrateLegacyStorage();
            } catch (err) {
              console.warn('[gameStore] migrateLegacyStorage failed', err);
            }

            let saves: GameSave[] = [];
            try {
              saves = await loadAllSaves();
              set({ saves });
            } catch (err) {
              console.warn('[gameStore] loadAllSaves failed', err);
            }

            const { currentSaveId, lastStoryId, isPlaying } = get();
            try {
              if (currentSaveId) {
                // Prefer in-memory saves first — `startGame()` writes a
                // seed there synchronously, but its IDB write is
                // fire-and-forget so `loadAllSaves()` may have raced
                // ahead of it and not seen the row yet.
                const memSaves = get().saves;
                const save = memSaves.find(s => s.id === currentSaveId)
                  || saves.find(s => s.id === currentSaveId)
                  || (await loadSave(currentSaveId));
                if (save) {
                  // After every await, re-read parsedStory from the store —
                  // the user may have picked a fresh preset on the home page
                  // mid-init (`setParsedStory` runs synchronously, this code
                  // sits behind awaits). Stomping their choice with stale
                  // IDB data is what produced the "请先上传故事" report.
                  const cur1 = get().parsedStory;
                  if (cur1 && cur1.id !== save.storyId) {
                    // User picked a different story; don't hydrate this save.
                  } else {
                    const story = cur1 && cur1.id === save.storyId
                      ? cur1
                      : await loadStory(save.storyId);
                    const cur2 = get().parsedStory;
                    if (cur2 && cur2.id !== save.storyId) {
                      // Same race, second checkpoint.
                    } else if (!story) {
                      // Save row exists but its story body is missing in IDB.
                      // Don't null out parsedStory — keep whatever's in memory
                      // and just hydrate the save's narrative state.
                      if (cur2) {
                        set({
                          narrativeHistory: save.narrativeHistory,
                          characterInteractions: save.characterInteractions,
                          lastStoryId: save.storyId,
                        });
                      }
                    } else {
                      set({
                        parsedStory: story,
                        narrativeHistory: save.narrativeHistory,
                        characterInteractions: save.characterInteractions,
                        lastStoryId: save.storyId,
                      });
                    }
                  }
                } else if (isPlaying) {
                  // The user just startGame'd (in-memory `isPlaying = true`)
                  // but the IDB seed write hasn't landed yet. Leave the
                  // session alone — clearing currentSaveId now would force
                  // /play into "请先完成设置".
                } else {
                  // Truly missing & not actively playing — clean up. Only
                  // touch parsedStory if the user hasn't picked one mid-init.
                  if (get().currentSaveId === currentSaveId) {
                    set({ currentSaveId: null });
                  }
                  if (lastStoryId && !get().parsedStory) {
                    const story = await loadStory(lastStoryId);
                    if (story && !get().parsedStory) set({ parsedStory: story });
                  }
                }
              } else if (lastStoryId && !get().parsedStory) {
                const story = await loadStory(lastStoryId);
                if (story && !get().parsedStory) set({ parsedStory: story });
              }
            } catch (err) {
              console.warn('[gameStore] save/story hydrate failed', err);
            }
          };

          // Watchdog: never let the spinner outlive INIT_WATCHDOG_MS.
          const watchdog = new Promise<void>((resolve) =>
            setTimeout(() => {
              console.warn(
                `[gameStore] init watchdog tripped after ${INIT_WATCHDOG_MS}ms; `
                + 'forcing _hydrated=true so the UI can fall through.',
              );
              resolve();
            }, INIT_WATCHDOG_MS),
          );

          try {
            await Promise.race([hydrate(), watchdog]);
          } catch (err) {
            console.error('[gameStore] init crashed', err);
          } finally {
            // _hydrated already defaults to true so this is a no-op for
            // gating purposes; we still set it explicitly in case some
            // external code flipped it.
            set({ _hydrated: true });
          }
        })();
        // If anything still slipped through and rejected, clear the
        // module-scope cache so the next init() call retries from
        // scratch instead of returning the same rejected promise.
        initPromise.catch(() => { initPromise = null; });
        return initPromise;
      },

      setLLMConfig: (config) => {
        saveLLMConfig(config);
        set({ llmConfig: config });
      },

      setParsedStory: (story) => {
        set({ parsedStory: story, lastStoryId: story.id });
        // Fire-and-forget: durability matters less than UI responsiveness here;
        // worst case we re-derive from a preset on next launch.
        saveStory(story).catch((err) =>
          console.warn('[storage] saveStory failed:', err));
      },

      setPlayerConfig: (config) => set({ playerConfig: config }),

      setGuardrailParams: (params) => set((s) => ({
        guardrailParams: { ...s.guardrailParams, ...params },
      })),

      setNarrativeBalance: (balance) => set((s) => ({
        narrativeBalance: { ...s.narrativeBalance, ...balance },
      })),

      setInjectionConfig: (config) => set((s) => ({
        injectionConfig: { ...s.injectionConfig, ...config },
      })),

      startGame: () => {
        const saveId = uuid();
        set({
          isPlaying: true,
          narrativeHistory: [],
          characterInteractions: [],
          currentSaveId: saveId,
        });
        // Fire an immediate autoSave so a hard-refresh of /play in the
        // narrow window before the first turn lands has an IDB row to
        // hydrate from. Without this, init() sees `currentSaveId` set
        // but `loadSave(currentSaveId)` returns null, and the UI either
        // gets stuck on "加载游戏中..." or falls through to "请先完成设置".
        const s = get();
        if (s.parsedStory && s.playerConfig) {
          const seed: GameSave = {
            id: saveId,
            storyId: s.parsedStory.id,
            storyTitle: s.parsedStory.title,
            playerConfig: s.playerConfig,
            narrativeHistory: [],
            characterInteractions: [],
            guardrailParams: s.guardrailParams,
            narrativeBalance: s.narrativeBalance,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isCompleted: false,
          };
          set({ saves: upsertSave(s.saves, seed) });
          saveSave(seed).catch(err =>
            console.warn('[storage] startGame seed save failed:', err));
        }
      },

      setIsParsing: (v) => set({ isParsing: v }),
      setIsGenerating: (v) => set({ isGenerating: v }),

      addNarrativeEntries: (entries) => set((s) => ({
        narrativeHistory: [...s.narrativeHistory, ...entries],
      })),

      addPlayerAction: (input) => set((s) => ({
        narrativeHistory: [
          ...s.narrativeHistory,
          {
            id: uuid(),
            type: 'player-action' as const,
            content: input,
            timestamp: Date.now(),
          },
        ],
      })),

      addCharacterInteractions: (newInteractions) => set((s) => {
        const existing = [...s.characterInteractions];
        for (const ni of newInteractions) {
          const idx = existing.findIndex(e => e.characterId === ni.characterId);
          if (idx >= 0) {
            existing[idx] = {
              ...existing[idx],
              interactions: [...existing[idx].interactions, ...ni.interactions],
            };
          } else {
            existing.push(ni);
          }
        }
        return { characterInteractions: existing };
      }),

      autoSave: () => {
        const s = get();
        if (!s.currentSaveId || !s.parsedStory || !s.playerConfig) return;
        const save: GameSave = {
          id: s.currentSaveId,
          storyId: s.parsedStory.id,
          storyTitle: s.parsedStory.title,
          playerConfig: s.playerConfig,
          narrativeHistory: s.narrativeHistory,
          characterInteractions: s.characterInteractions,
          guardrailParams: s.guardrailParams,
          narrativeBalance: s.narrativeBalance,
          createdAt: s.saves.find(sv => sv.id === s.currentSaveId)?.createdAt || Date.now(),
          updatedAt: Date.now(),
          isCompleted: false,
        };
        // Optimistic in-memory update, IDB write is fire-and-forget.
        set({ saves: upsertSave(s.saves, save) });
        saveSave(save).catch((err) =>
          console.warn('[storage] autoSave failed:', err));
      },

      completeGame: (result) => {
        const s = get();
        if (!s.currentSaveId || !s.parsedStory || !s.playerConfig) return;
        const save: GameSave = {
          id: s.currentSaveId,
          storyId: s.parsedStory.id,
          storyTitle: s.parsedStory.title,
          playerConfig: s.playerConfig,
          narrativeHistory: s.narrativeHistory,
          characterInteractions: s.characterInteractions,
          guardrailParams: s.guardrailParams,
          narrativeBalance: s.narrativeBalance,
          createdAt: s.saves.find(sv => sv.id === s.currentSaveId)?.createdAt || Date.now(),
          updatedAt: Date.now(),
          isCompleted: true,
          epilogue: result.memoirs,
          storyArc: result.storyArc,
        };
        set({ saves: upsertSave(s.saves, save), isPlaying: false });
        saveSave(save).catch((err) =>
          console.warn('[storage] completeGame save failed:', err));
      },

      loadSaves: async () => {
        const saves = await loadAllSaves();
        set({ saves });
      },

      loadFromSave: (save, story) => {
        set({
          parsedStory: story,
          playerConfig: save.playerConfig,
          narrativeHistory: save.narrativeHistory,
          characterInteractions: save.characterInteractions,
          guardrailParams: save.guardrailParams,
          narrativeBalance: save.narrativeBalance,
          currentSaveId: save.id,
          isPlaying: true,
        });
      },

      removeSave: async (saveId) => {
        await deleteSave(saveId);
        set((s) => ({ saves: s.saves.filter(sv => sv.id !== saveId) }));
      },

      resetGame: () => set({
        isPlaying: false,
        narrativeHistory: [],
        characterInteractions: [],
        currentSaveId: null,
        playerConfig: null,
      }),

      resetAll: () => set({
        ...initialState,
        llmConfig: get().llmConfig,
        saves: get().saves,
        _hydrated: true,
      }),
    }),
    {
      name: 'ai-toktok-runtime',
      storage: createJSONStorage(() => localStorage),
      /**
       * Only the small, hot fields persist via localStorage. Large fields —
       * parsedStory (with its 30 万字 originalText), narrativeHistory,
       * characterInteractions — live in IndexedDB and are rehydrated on
       * `init()` based on `currentSaveId`. saves[] is also IDB-sourced; we
       * don't persist it here to avoid duplication.
       */
      partialize: (state) => ({
        playerConfig: state.playerConfig,
        guardrailParams: state.guardrailParams,
        narrativeBalance: state.narrativeBalance,
        injectionConfig: state.injectionConfig,
        isPlaying: state.isPlaying,
        currentSaveId: state.currentSaveId,
        lastStoryId: state.lastStoryId,
      }),
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        // v1 used to persist parsedStory / narrativeHistory / characterInteractions
        // straight into localStorage. Drop those fields — they'll come from
        // IDB on next init(). currentSaveId is preserved so rehydration knows
        // which save to load.
        if (version < 2 && persisted && typeof persisted === 'object') {
          const p = persisted as Record<string, unknown>;
          delete p.parsedStory;
          delete p.narrativeHistory;
          delete p.characterInteractions;
          delete p.saves;
          return p;
        }
        // v2 → v3: Phase 1 introduced the modular type tree (IPProject /
        // WorldEntity / AgentProfile / Scene / StateDelta). Nothing
        // persisted in localStorage references those yet — they live in IDB
        // — but bumping the version forces a re-hydrate so any stray cached
        // state from an older code path is discarded cleanly.
        return persisted;
      },
    },
  ),
);
