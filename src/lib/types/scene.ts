/**
 * Scene + ConversationMessage + ConflictState — the runtime side of an
 * active playthrough. Today the runtime is one flat `narrativeHistory` array
 * inside `gameStore`; Phase 3+5 carve out an explicit Scene record so we can
 * track who-is-present and per-scene state independent of message order.
 */

export type SceneStatus =
  | 'active'      // currently being played in
  | 'paused'      // user moved away but can resume
  | 'completed';  // closed (all open conflicts resolved or scene ended)

/**
 * Conflict state machine. Most stories have multiple parallel conflicts;
 * each one progresses through stages independently and may unlock branch
 * hints when transitions happen.
 */
export type ConflictStage =
  | 'latent'
  | 'rising'
  | 'climax'
  | 'falling'
  | 'resolved';

export interface ConflictState {
  id: string;
  projectId: string;
  /** Short name, e.g. '老白与索尔的债务'. */
  title: string;
  description?: string;
  involvedEntityIds?: string[];
  stage: ConflictStage;
  /** Loose tension scalar, 0..1. Used for prompt nudges and UI heat. */
  intensity?: number;
  /** Free-form record of how it has shifted across turns. */
  notes?: string[];
}

export interface Scene {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  /** WorldEntity id for the location. Optional for stories without a fixed setting. */
  locationId?: string;
  /** AgentProfile ids currently in scene. Replaces the "recent N" heuristic. */
  presentAgentIds: string[];
  activeConflictIds?: string[];
  /** TimelineEvent.orderIndex this scene anchors to, when applicable. */
  timelinePosition?: number;
  /** Atmosphere keyword: 'tense', 'wistful', 'cathartic'... */
  mood?: string;
  status: SceneStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-scene runtime snapshot. The scene record itself stays stable; the
 * snapshot rolls forward each turn so we don't have to recompute everything
 * from the message log when re-entering a save.
 */
export interface SceneState {
  sceneId: string;
  /** ISO turn pointer — increments on every player action. */
  turn: number;
  /** Last computed mood; may diverge from `Scene.mood` between updates. */
  mood?: string;
  /** Non-protagonist agents who became silent vs active this turn. */
  recentResponderIds?: string[];
}

/**
 * New conversation log shape. Mirrors `NarrativeEntry` semantics but adds
 * sceneId, hidden intent, and per-message stateDelta linkage. Phase 5 will
 * start writing these alongside the legacy entries; the legacy array stays
 * authoritative for now.
 */
export type SpeakerType = 'user' | 'npc' | 'narrator' | 'system';

export interface ConversationMessage {
  id: string;
  sceneId: string;
  speakerType: SpeakerType;
  /** AgentProfile.id when speakerType === 'npc'; otherwise blank or 'system'. */
  speakerId?: string;
  /** Public dialogue / narration / player action text. */
  content: string;
  /** Optional non-verbal action ("拔剑出鞘"). */
  actionText?: string;
  /** Emotion keyword set on the speaker for this turn. */
  emotion?: string;
  createdAt: number;
  /** Pointer to the StateDelta that this message produced, if any. */
  stateDeltaId?: string;
  /**
   * NPC's hidden intent for this line. Never shown to the player; consumed
   * by RuntimeMemory + downstream prompts. Only present on NPC messages.
   */
  hiddenIntent?: string;
}
