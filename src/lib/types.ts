// ===== 核心类型定义 =====
//
// This file is the legacy single-file type module. Phase 1 introduced
// `src/lib/types/` (world.ts / agent.ts / scene.ts / runtime.ts) for the
// blueprint domain model; we re-export everything from there at the bottom
// of this file so existing `import { Foo } from '@/lib/types'` calls keep
// working without churn.

export type {
  // world.ts
  SourceRef, WorldEntityType, WorldEntity, Faction, Relationship,
  LoreEntry, TimelineEvent, SourceChunk, IPProjectStatus,
  IPProjectBuildConfig, IPProject,
  // agent.ts
  AgentRelationshipRef, AgentBehaviorRule, AgentProfile,
  UserIdentityType, UserIdentity,
  // scene.ts
  SceneStatus, ConflictStage, ConflictState, Scene, SceneState,
  SpeakerType, ConversationMessage,
  // runtime.ts
  MemoryScope, RuntimeMemory, RelationshipChange, MemoryUpdate,
  ConflictChange, TimelineUpdate, StateDelta,
  StoryArcStats, StoryArcReport,
} from './types/index';

/** LLM 提供商 */
export type LLMProvider = 'openai' | 'anthropic';

/** LLM 配置 */
export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string; // 自定义 API 地址，支持 OpenAI 兼容接口
}

/** 角色信息 */
export interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  background: string;
  relationships: { characterId: string; relation: string }[];
  isOriginal: boolean; // 是否为原作角色
}

/** 地点信息 */
export interface Location {
  id: string;
  name: string;
  description: string;
}

/** 关键事件 */
export interface KeyEvent {
  id: string;
  title: string;
  description: string;
  timeIndex: number; // 在故事中的顺序
  involvedCharacterIds: string[];
  locationId?: string;
}

/** 世界观设定 */
export interface WorldSetting {
  era: string;           // 时代背景
  genre: string;         // 类型（奇幻、武侠、科幻等）
  rules: string[];       // 世界规则（如：有魔法、无科技等）
  toneDescription: string; // 叙事风格描述
}

/** 解析后的故事数据 */
export interface ParsedStory {
  id: string;
  title: string;
  originalText: string;
  summary: string;
  worldSetting: WorldSetting;
  characters: Character[];
  locations: Location[];
  keyEvents: KeyEvent[];
  timelineDescription: string;

  // ---- Phase 1 additive fields. All optional so old saves & presets stay
  //      valid. Phase 2's world_builder will populate them; until then they
  //      may be undefined and code paths must default-guard.
  /**
   * Container record. When present, identifies the story as belonging to a
   * named project with its own buildConfig (import goal, etc.).
   */
  project?: import('./types/index').IPProject;
  /** Unified entity table — characters/locations/factions/items/concepts. */
  entities?: import('./types/index').WorldEntity[];
  /** Standalone faction records (also addressable through entities[]). */
  factions?: import('./types/index').Faction[];
  /** Top-level relationship table (vs. the legacy embedded form). */
  relationships?: import('./types/index').Relationship[];
  /** Keyword-triggered lore for the L4 injection layer. */
  loreEntries?: import('./types/index').LoreEntry[];
  /** Causal timeline (richer than `keyEvents`). */
  timelineEvents?: import('./types/index').TimelineEvent[];
  /** Pre-generated NPC AgentProfiles, when produced by agent_factory. */
  agents?: import('./types/index').AgentProfile[];
}

/** 介入方式 */
export type EntryMode = 'soul-transfer' | 'reincarnation';

/** 玩家角色配置 */
export interface PlayerConfig {
  entryMode: EntryMode;
  characterId?: string;         // 魂穿时选择的角色ID
  customCharacter?: Character;  // 转生时生成的新角色
  entryEventIndex: number;      // 进入的时间节点
}

/** 叙事/对话比重 */
export interface NarrativeBalance {
  narrativeWeight: number; // 0-100, 值越大叙事越多
}

/** 世界观护栏参数 */
export interface GuardrailParams {
  temperature: number;  // 0.0-1.0 随机性
  strictness: number;   // 0.0-1.0 严谨度
}

/**
 * 角色/地点信息的注入策略。
 * - `full`：旧行为，所有非玩家角色 + 所有地点全量注入（保留作为安全回滚）
 * - `smart`：只把"常驻 + 触发命中 + 1 度关系扩散"展开成详情，其余角色仅一行花名册，
 *   未触发的地点完全省略
 */
export interface InjectionConfig {
  mode: 'smart' | 'full';
  /** smart 模式下扫描最近多少条 narrativeHistory 找触发词 */
  windowSize: number;
  /** 沿 relationships 扩散的深度，0 表示禁用 */
  expandDepth: 0 | 1;
  /** 详情角色集合的硬上限（防止扩散后 prompt 失控） */
  maxTriggered: number;
}

/** 选项 */
export interface StoryChoice {
  id: string;
  text: string;
  isBranchPoint: boolean; // 是否为关键分支点
}

/** 单条叙事记录 */
export interface NarrativeEntry {
  id: string;
  type: 'narration' | 'dialogue' | 'player-action' | 'system';
  speaker?: string;        // 对话时的说话者
  content: string;
  choices?: StoryChoice[]; // 系统提供的选项
  playerInput?: string;    // 玩家的输入
  timestamp: number;
}

/** 角色交互记录（用于后日谈） */
export interface CharacterInteraction {
  characterId: string;
  characterName: string;
  interactions: {
    event: string;
    playerAction: string;
    characterReaction: string;
    sentiment: 'positive' | 'neutral' | 'negative';
  }[];
}

/** 后日谈条目 */
export interface EpilogueEntry {
  characterId: string;
  characterName: string;
  memoir: string; // 角色对玩家的回忆评价
}

/** 游戏存档 */
export interface GameSave {
  id: string;
  storyId: string;
  storyTitle: string;
  playerConfig: PlayerConfig;
  narrativeHistory: NarrativeEntry[];
  characterInteractions: CharacterInteraction[];
  guardrailParams: GuardrailParams;
  narrativeBalance: NarrativeBalance;
  createdAt: number;
  updatedAt: number;
  isCompleted: boolean;
  epilogue?: EpilogueEntry[];
  /**
   * End-of-run story arc recap (Phase: post-Phase-8 expansion). Optional —
   * older completed saves don't have it; the epilogue UI falls back to
   * just memoirs in that case.
   */
  storyArc?: import('./types/index').StoryArcReport;
}

/** 游戏状态 */
export interface GameState {
  // 配置
  llmConfig: LLMConfig | null;
  parsedStory: ParsedStory | null;
  playerConfig: PlayerConfig | null;
  guardrailParams: GuardrailParams;
  narrativeBalance: NarrativeBalance;
  injectionConfig: InjectionConfig;

  // 游戏进行中状态
  isPlaying: boolean;
  isParsing: boolean;
  isGenerating: boolean;
  narrativeHistory: NarrativeEntry[];
  characterInteractions: CharacterInteraction[];
  currentSaveId: string | null;

  // 存档列表
  saves: GameSave[];

  /**
   * Pointer to the last `setParsedStory()` argument's id. Persisted in
   * localStorage so a hard refresh between 解析完成 and startGame can still
   * rehydrate parsedStory from IDB even before any save exists.
   */
  lastStoryId: string | null;

  /**
   * IndexedDB hydration progress flag. **Initialised to `true`** so the
   * store never blocks the UI on async IDB reads — page-level guards
   * already handle missing `parsedStory` / `playerConfig` cleanly, and
   * a previous attempt to gate the UI on this flag deadlocked /play
   * whenever an IDB transaction got stuck. Kept here for backwards
   * compatibility with any external code that still references it; new
   * code should not gate rendering on it.
   */
  _hydrated: boolean;
}
