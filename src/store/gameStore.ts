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
  _hydrated: false,
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

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      init: () => {
        if (initPromise) return initPromise;
        initPromise = (async () => {
          const config = loadLLMConfig();
          // transient flags should never survive a reload
          set({
            llmConfig: config,
            isParsing: false,
            isGenerating: false,
          });

          // One-time migration of any legacy localStorage payloads. Idempotent
          // — sets a marker on success and short-circuits on subsequent runs.
          await migrateLegacyStorage();

          // Async load saves index from IDB.
          const saves = await loadAllSaves();
          set({ saves });

          // If a game was in progress, hydrate the large fields (story body +
          // narrative history) from IDB based on currentSaveId.
          const { currentSaveId, lastStoryId } = get();
          if (currentSaveId) {
            const save = saves.find(s => s.id === currentSaveId)
              || (await loadSave(currentSaveId));
            if (save) {
              const story = await loadStory(save.storyId);
              set({
                parsedStory: story,
                narrativeHistory: save.narrativeHistory,
                characterInteractions: save.characterInteractions,
                lastStoryId: save.storyId,
              });
            } else {
              // Save vanished — clear the stale pointer so /play falls through
              // to its "请先完成设置" branch instead of looping on a missing id.
              set({ currentSaveId: null, isPlaying: false });
            }
          } else if (lastStoryId) {
            // Between 解析完成 and startGame: no save yet, but we still want
            // /setup to rehydrate the story body after a hard refresh.
            const story = await loadStory(lastStoryId);
            if (story) set({ parsedStory: story });
          }

          set({ _hydrated: true });
        })();
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
