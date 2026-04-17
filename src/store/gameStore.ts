import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  GameState, LLMConfig, ParsedStory, PlayerConfig,
  GuardrailParams, NarrativeBalance, NarrativeEntry,
  CharacterInteraction, GameSave, EpilogueEntry,
} from '@/lib/types';
import { saveSave, loadAllSaves, saveLLMConfig, loadLLMConfig, saveStory } from '@/lib/storage';
import { v4 as uuid } from 'uuid';

interface GameActions {
  // 配置
  setLLMConfig: (config: LLMConfig) => void;
  setParsedStory: (story: ParsedStory) => void;
  setPlayerConfig: (config: PlayerConfig) => void;
  setGuardrailParams: (params: Partial<GuardrailParams>) => void;
  setNarrativeBalance: (balance: Partial<NarrativeBalance>) => void;

  // 游戏控制
  startGame: () => void;
  setIsParsing: (v: boolean) => void;
  setIsGenerating: (v: boolean) => void;
  addNarrativeEntries: (entries: NarrativeEntry[]) => void;
  addPlayerAction: (input: string) => void;
  addCharacterInteractions: (interactions: CharacterInteraction[]) => void;

  // 存档
  autoSave: () => void;
  completeGame: (epilogue: EpilogueEntry[]) => void;
  loadSaves: () => void;
  loadFromSave: (save: GameSave, story: ParsedStory) => void;

  // 重置
  resetGame: () => void;
  resetAll: () => void;

  // 初始化
  init: () => void;
}

const defaultGuardrail: GuardrailParams = { temperature: 0.5, strictness: 0.6 };
const defaultBalance: NarrativeBalance = { narrativeWeight: 50 };

const initialState: GameState = {
  llmConfig: null,
  parsedStory: null,
  playerConfig: null,
  guardrailParams: defaultGuardrail,
  narrativeBalance: defaultBalance,
  isPlaying: false,
  isParsing: false,
  isGenerating: false,
  narrativeHistory: [],
  characterInteractions: [],
  currentSaveId: null,
  saves: [],
};

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
  ...initialState,

  init: () => {
    const config = loadLLMConfig();
    const saves = loadAllSaves();
    set({
      llmConfig: config as LLMConfig | null,
      saves,
      // transient flags should never survive a reload
      isParsing: false,
      isGenerating: false,
    });
  },

  setLLMConfig: (config) => {
    saveLLMConfig(config);
    set({ llmConfig: config });
  },

  setParsedStory: (story) => {
    saveStory(story);
    set({ parsedStory: story });
  },

  setPlayerConfig: (config) => set({ playerConfig: config }),

  setGuardrailParams: (params) => set((s) => ({
    guardrailParams: { ...s.guardrailParams, ...params },
  })),

  setNarrativeBalance: (balance) => set((s) => ({
    narrativeBalance: { ...s.narrativeBalance, ...balance },
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
    saveSave(save);
    set({ saves: loadAllSaves() });
  },

  completeGame: (epilogue) => {
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
      epilogue,
    };
    saveSave(save);
    set({ saves: loadAllSaves(), isPlaying: false });
  },

  loadSaves: () => {
    set({ saves: loadAllSaves() });
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
  }),
    }),
    {
      name: 'ai-toktok-runtime',
      storage: createJSONStorage(() => localStorage),
      // Persist only what's needed to survive a reload mid-game. llmConfig and
      // saves have their own storage keys; isParsing/isGenerating are transient
      // UI flags.
      partialize: (state) => ({
        parsedStory: state.parsedStory,
        playerConfig: state.playerConfig,
        guardrailParams: state.guardrailParams,
        narrativeBalance: state.narrativeBalance,
        isPlaying: state.isPlaying,
        narrativeHistory: state.narrativeHistory,
        characterInteractions: state.characterInteractions,
        currentSaveId: state.currentSaveId,
      }),
      version: 1,
    },
  ),
);
