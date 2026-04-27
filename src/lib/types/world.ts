/**
 * Domain model for the static side of an IP — what got extracted from the
 * source text. These are blueprint §3 types in code form.
 *
 * Backwards-compatibility rule: every field is optional. The legacy
 * `Character` / `Location` / `KeyEvent` types in `../types.ts` keep their
 * shape; new entities live alongside on `ParsedStory` as additive arrays.
 */

/**
 * Reference back to the source-text chunk an entity / relation / event was
 * derived from. Lets the UI surface "why does the model think this" in a
 * future Phase 4 debug panel.
 */
export interface SourceRef {
  chunkIndex: number;
  /** Optional verbatim quote — kept short (<= 80 chars) to bound storage. */
  excerpt?: string;
}

export type WorldEntityType =
  | 'character'
  | 'location'
  | 'faction'
  | 'item'
  | 'concept'
  | 'event';

/**
 * Unified entity record. Today the UI still reads from
 * `ParsedStory.characters` / `.locations` / `.keyEvents`; Phase 2 will start
 * populating `ParsedStory.entities` in parallel and Phase 7's World Overview
 * page reads from this table.
 */
export interface WorldEntity {
  id: string;
  projectId: string;
  name: string;
  type: WorldEntityType;
  aliases?: string[];
  description?: string;
  /** 1 (background) … 5 (central). Populated heuristically by world_builder. */
  importance?: number;
  /** Free-form attributes the LLM emits — e.g. {role: '反派', age: 'mid-30s'} */
  attributes?: Record<string, unknown>;
  sourceRefs?: SourceRef[];
}

/**
 * A faction is a group with shared goals/identity. Distinct from a
 * `WorldEntity` of type `'faction'` only when extra fields are needed; we
 * keep this as a separate interface so the UI can render group cards
 * without coercing.
 */
export interface Faction {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  ideology?: string;
  memberEntityIds?: string[];
  rivals?: string[];
  sourceRefs?: SourceRef[];
}

/**
 * Top-level relationship table. Replaces the in-`Character.relationships`
 * embedding for the new path; the legacy embedding stays for old saves.
 */
export interface Relationship {
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  /** Free-form label, e.g. '父子', '宿敌', '同事'. */
  relationType: string;
  description?: string;
  /** -1 (mutual hatred) .. 0 (neutral) .. 1 (deep trust) */
  polarity?: number;
  /** 0 .. 1 — absolute intensity, regardless of sign. */
  strength?: number;
  evidence?: string[];
  sourceRefs?: SourceRef[];
}

/**
 * Standalone lore entry with keyword triggers. The L4 keyword-triggered
 * injection layer (Phase 4) scans these against player input + recent
 * narration to decide what world-bible blocks to drop into the prompt.
 */
export interface LoreEntry {
  id: string;
  projectId: string;
  title: string;
  content: string;
  tags?: string[];
  relatedEntityIds?: string[];
  /** 1 (trivia) … 5 (must-know). Higher = preferred under token pressure. */
  importance?: number;
  /** Words/phrases that activate this entry when seen in scan text. */
  triggerKeywords?: string[];
  sourceRefs?: SourceRef[];
}

/**
 * Causal timeline event — richer than the legacy `KeyEvent`.
 * `KeyEvent` stays as the player-facing shape; `TimelineEvent` is the
 * graph-side shape that supports cause/consequence chaining.
 */
export interface TimelineEvent {
  id: string;
  projectId: string;
  title: string;
  description: string;
  orderIndex: number;
  timeLabel?: string;
  participants?: string[];
  locations?: string[];
  causes?: string[];
  consequences?: string[];
  sourceRefs?: SourceRef[];
}

/**
 * Source chunk record. The parser already chunks text; this record makes the
 * provenance trail explicit so debugging panels can highlight where a fact
 * came from.
 */
export interface SourceChunk {
  id: string;
  projectId: string;
  index: number;
  text: string;
  summary?: string;
  startOffset?: number;
  endOffset?: number;
  metadata?: Record<string, unknown>;
}

/**
 * IP project envelope. The legacy app effectively had one implicit project
 * per loaded `ParsedStory`. Phase 1 introduces the explicit container so
 * later phases can hold more than one project per origin.
 */
export type IPProjectStatus =
  | 'imported'
  | 'parsing'
  | 'built'
  | 'playable'
  | 'failed';

export interface IPProjectBuildConfig {
  /** Phase 7 wiring; faithful / free / companion / scenario from the wizard. */
  importGoal?: 'faithful' | 'free_rewrite' | 'companion' | 'scenario';
  /** Reserved for future use. */
  [k: string]: unknown;
}

export interface IPProject {
  id: string;
  title: string;
  description?: string;
  sourceType?: 'paste' | 'upload' | 'preset';
  sourceFiles?: string[];
  status: IPProjectStatus;
  createdAt: number;
  updatedAt: number;
  buildConfig?: IPProjectBuildConfig;
}
