/**
 * Runtime memory + StateDelta — the things that change as the player plays.
 *
 * `StateDelta` is the canonical "diff" the dialogue runtime emits per turn.
 * `state_updater` consumes it to update relationships, agent memories,
 * conflicts, and the timeline. Phase 5 wires the producer/consumer; the
 * type lives here so types/runtime.ts is the single source of truth.
 */

/**
 * Memory items are scoped:
 *   - 'project' — global to the IP (rare; mostly extracted lore).
 *   - 'agent'   — what a single NPC has personally observed/experienced.
 *   - 'scene'   — facts that matter only inside the current scene.
 *   - 'user'    — long-term memory of the player as a character.
 */
export type MemoryScope = 'project' | 'agent' | 'scene' | 'user';

export interface RuntimeMemory {
  id: string;
  projectId: string;
  scope: MemoryScope;
  /** AgentProfile.id / Scene.id / userIdentity.id depending on scope. */
  scopeId: string;
  content: string;
  /** Optional embedding for vector retrieval (Phase 8 may add). */
  embedding?: number[];
  /** 1 (forgettable) … 5 (defining moment). Drives retention under pressure. */
  importance?: number;
  createdAt: number;
}

/**
 * Per-turn diff. The dialogue prompt's JSON contract emits a `stateDelta`
 * object; `applyStateDelta()` (Phase 5) translates it into writes against
 * the relationship table, agent memories, conflict states, and the
 * timeline.
 */
export interface RelationshipChange {
  sourceEntityId: string;
  targetEntityId: string;
  /** Negative or positive shift on the polarity scale. */
  polarityDelta?: number;
  strengthDelta?: number;
  /** Free-text reason — surfaces in Phase 6 reflection reports. */
  reason?: string;
}

export interface MemoryUpdate {
  scope: MemoryScope;
  scopeId: string;
  content: string;
  importance?: number;
}

export interface ConflictChange {
  conflictId: string;
  newStage?: import('./scene').ConflictStage;
  intensityDelta?: number;
  note?: string;
}

export interface TimelineUpdate {
  /** When inserting a new event; otherwise reference an existing id. */
  id?: string;
  title: string;
  description?: string;
  participants?: string[];
  causes?: string[];
  consequences?: string[];
}

export interface StateDelta {
  id: string;
  sceneId: string;
  /** ConversationMessage.id that produced this delta. */
  messageId: string;
  relationshipChanges?: RelationshipChange[];
  memoryUpdates?: MemoryUpdate[];
  conflictChanges?: ConflictChange[];
  timelineUpdates?: TimelineUpdate[];
  /** LoreEntry ids that became visible to the player this turn. */
  unlockedLoreEntries?: string[];
  createdAt: number;
}

/**
 * Pure-derived metrics for the end-of-run story-arc summary. None of these
 * involve an LLM call — they're computed from `narrativeHistory` +
 * `characterInteractions` so the chips stay accurate even on a partial
 * generation.
 */
export interface StoryArcStats {
  /** Player-action count — how many turns the player took. */
  totalTurns: number;
  /** Distinct location names appearing in narration / dialogue text. */
  locationsVisited: number;
  /** Distinct NPC speakers across the playthrough. */
  dialogueCharacters: number;
  /** Scenes where ≥3 distinct named characters were on stage at once. */
  groupSceneCount: number;
  /** Total interactions whose sentiment was non-neutral (good or bad). */
  relationshipShifts: number;
}

/**
 * LLM-generated 起承转合 ("setup / development / turn / resolution")
 * recap of the playthrough. Total prose is targeted at 200-400 字, split
 * roughly evenly across the four phases.
 */
export interface StoryArcReport {
  qi: string;     // 起 — opening / how the player entered the world
  cheng: string;  // 承 — what built up
  zhuan: string;  // 转 — turning point the player caused
  he: string;     // 合 — resolution / standing of the world & relationships
  stats: StoryArcStats;
}
