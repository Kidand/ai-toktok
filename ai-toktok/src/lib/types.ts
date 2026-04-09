// ===== 核心类型定义 =====

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
}

/** 游戏状态 */
export interface GameState {
  // 配置
  llmConfig: LLMConfig | null;
  parsedStory: ParsedStory | null;
  playerConfig: PlayerConfig | null;
  guardrailParams: GuardrailParams;
  narrativeBalance: NarrativeBalance;

  // 游戏进行中状态
  isPlaying: boolean;
  isParsing: boolean;
  isGenerating: boolean;
  narrativeHistory: NarrativeEntry[];
  characterInteractions: CharacterInteraction[];
  currentSaveId: string | null;

  // 存档列表
  saves: GameSave[];
}
