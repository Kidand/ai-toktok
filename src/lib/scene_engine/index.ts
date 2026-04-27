/**
 * scene_engine — explicit Scene records for the runtime.
 *
 * Today the play loop tracks "who's present" by re-scanning the last 5
 * narrative entries (PRESENCE_WINDOW in `play/page.tsx`). That heuristic is
 * fine for dialog rendering but doesn't survive a save/load and can't drive
 * Phase 5's responder-selection logic.
 *
 * This module produces a real `Scene` entity at the start of a playthrough
 * and exposes pure helpers Phases 5/6 will call when advancing it.
 *
 * Phase 3 lands the constructors and a state summariser; the play page
 * still uses its own heuristic for now (replaced in Phase 5).
 */

import { v4 as uuid } from 'uuid';
import type {
  AgentProfile, Character, NarrativeEntry, ParsedStory,
  PlayerConfig, Scene, SceneState,
} from '../types';

/**
 * Build the opening Scene for a fresh playthrough.
 *
 * `presentAgentIds` is seeded from:
 *   - the player character (if any) — excluded automatically
 *   - the entry event's `involvedCharacterIds` — these are the NPCs the
 *     player most likely runs into in the first turn
 * If neither is available, fall back to the top-3 most central characters.
 */
export function createOpeningScene(
  story: ParsedStory,
  playerConfig: PlayerConfig,
  agents: AgentProfile[],
): Scene {
  const projectId = story.project?.id || story.id;
  const entryEvent = story.keyEvents[playerConfig.entryEventIndex];
  const playerCharId = playerConfig.entryMode === 'soul-transfer'
    ? playerConfig.characterId
    : undefined;

  const charIdToAgent = new Map(agents.map(a => [a.entityId, a.id]));

  let presentAgentIds: string[] = [];
  if (entryEvent && entryEvent.involvedCharacterIds.length > 0) {
    presentAgentIds = entryEvent.involvedCharacterIds
      .filter(cid => cid !== playerCharId)
      .map(cid => charIdToAgent.get(cid))
      .filter((id): id is string => Boolean(id));
  }
  if (presentAgentIds.length === 0) {
    presentAgentIds = pickCentralAgents(story, playerCharId, charIdToAgent, 3);
  }

  return {
    id: uuid(),
    projectId,
    title: entryEvent?.title || '故事开端',
    description: entryEvent?.description || story.summary?.slice(0, 200) || '',
    locationId: entryEvent?.locationId,
    presentAgentIds,
    activeConflictIds: [],
    timelinePosition: entryEvent ? entryEvent.timeIndex : 0,
    mood: inferMood(story, entryEvent),
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Compute a fresh runtime snapshot from the persisted `narrativeHistory`.
 * Used when re-entering a save: we don't replay the whole history, we just
 * derive the latest mood / responder set / turn pointer.
 */
export function getSceneState(scene: Scene, history: NarrativeEntry[]): SceneState {
  const turn = history.filter(e => e.type === 'player-action').length;
  const recent = history.slice(-6);
  const recentResponderIds = unique(
    recent
      .filter(e => e.type === 'dialogue' && e.speaker)
      .map(e => e.speaker as string),
  );
  return {
    sceneId: scene.id,
    turn,
    mood: scene.mood,
    recentResponderIds,
  };
}

/**
 * Update an existing scene with new presence information. Returns a fresh
 * Scene record (immutable). Phase 5's dialogue orchestrator will call this
 * after every responder set decision.
 */
export function advanceScene(
  scene: Scene,
  patch: Partial<Pick<Scene, 'presentAgentIds' | 'activeConflictIds' | 'mood' | 'status'>>,
): Scene {
  return {
    ...scene,
    ...patch,
    updatedAt: Date.now(),
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

function pickCentralAgents(
  story: ParsedStory,
  playerCharId: string | undefined,
  charIdToAgent: Map<string, string>,
  k: number,
): string[] {
  // Score by event participation count, then relationship density.
  const score = (c: Character): number => {
    const eventHits = story.keyEvents.filter(e => e.involvedCharacterIds.includes(c.id)).length;
    const relCount = c.relationships?.length || 0;
    return eventHits * 2 + relCount;
  };
  const scored = story.characters
    .filter(c => c.id !== playerCharId)
    .map(c => ({ id: charIdToAgent.get(c.id), s: score(c) }))
    .filter((x): x is { id: string; s: number } => Boolean(x.id))
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
  return scored.map(x => x.id);
}

function inferMood(story: ParsedStory, entryEvent?: { description: string }): string {
  const tone = (story.worldSetting.toneDescription || '').toLowerCase();
  if (/紧张|悬疑|阴郁|压抑/.test(tone)) return 'tense';
  if (/温馨|治愈|轻松/.test(tone)) return 'gentle';
  if (/壮阔|史诗|辉煌/.test(tone)) return 'epic';
  const desc = (entryEvent?.description || '').toLowerCase();
  if (/危机|战斗|对峙/.test(desc)) return 'tense';
  return 'neutral';
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
