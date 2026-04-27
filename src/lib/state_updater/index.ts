/**
 * state_updater — apply a `StateDelta` to the persisted world.
 *
 * The Phase 5 dialogue orchestrator emits a `StateDelta` per turn (when
 * the LLM produces one). This module is the single consumer that
 * translates that delta into writes against the relationship table,
 * RuntimeMemory, ConflictState, and the Timeline.
 *
 * Storage strategy:
 *   - `RuntimeMemory` writes go straight to IDB via `storage.saveRuntimeMemory`.
 *   - `StateDelta` itself is persisted in IDB so a Phase 6 reflection
 *     report can replay "what changed in the last N turns".
 *   - `Relationship` polarity / strength updates mutate the in-memory
 *     story.relationships table; callers are expected to re-persist the
 *     story. We don't re-write the legacy `Character.relationships`
 *     embedding because polarity is metadata that doesn't fit there.
 *   - `ConflictState` and timeline updates are kept in-memory on the
 *     scene/runtime layer and persisted by the orchestrator alongside
 *     other scene state.
 */

import { v4 as uuid } from 'uuid';
import {
  saveStateDelta, saveRuntimeMemory,
} from '../storage';
import { logEvent } from '../telemetry';
import type {
  ConflictState, MemoryScope, RuntimeMemory, ParsedStory,
  Relationship, StateDelta, TimelineEvent,
} from '../types';

export interface ApplyStateDeltaInput {
  /** The delta to apply. `id` and `createdAt` are stamped if missing. */
  delta: Partial<StateDelta> & Pick<StateDelta, 'sceneId' | 'messageId'>;
  /** Authoritative project id for this playthrough. */
  projectId: string;
  /** In-memory story being mutated; relationship polarity is patched here. */
  story: ParsedStory;
  /** In-memory conflict state map keyed by id; updated in place. */
  conflictStates?: Map<string, ConflictState>;
  /** In-memory timeline; new events appended. */
  timelineEvents?: TimelineEvent[];
  /** Resolver from human-readable name to `WorldEntity.id`. */
  nameToEntityId?: Map<string, string>;
}

export interface ApplyStateDeltaResult {
  /** The fully-formed StateDelta as persisted (with id / createdAt). */
  applied: StateDelta;
  /** RuntimeMemory records written this turn. */
  memories: RuntimeMemory[];
  /** Relationship rows whose polarity/strength was updated. */
  relationshipsTouched: Relationship[];
  /** ConflictState ids whose stage advanced. */
  conflictsAdvanced: string[];
  /** TimelineEvent records appended. */
  timelineAppended: TimelineEvent[];
}

/**
 * Apply a delta. All side effects are best-effort: IDB failures are
 * logged but don't abort the call. Callers should treat the in-memory
 * mutations as authoritative for the current session.
 */
export async function applyStateDelta(
  input: ApplyStateDeltaInput,
): Promise<ApplyStateDeltaResult> {
  const { story, projectId } = input;
  const nameToEntityId = input.nameToEntityId
    || new Map(story.characters.map(c => [c.name, c.id]));

  const now = Date.now();
  const applied: StateDelta = {
    id: input.delta.id || uuid(),
    sceneId: input.delta.sceneId,
    messageId: input.delta.messageId,
    relationshipChanges: input.delta.relationshipChanges || [],
    memoryUpdates: input.delta.memoryUpdates || [],
    conflictChanges: input.delta.conflictChanges || [],
    timelineUpdates: input.delta.timelineUpdates || [],
    unlockedLoreEntries: input.delta.unlockedLoreEntries || [],
    createdAt: input.delta.createdAt || now,
  };

  // ---- Relationships
  const relationshipsTouched: Relationship[] = [];
  if (story.relationships && applied.relationshipChanges) {
    for (const change of applied.relationshipChanges) {
      const src = nameToEntityId.get((change as unknown as { sourceName?: string }).sourceName || '')
        || change.sourceEntityId;
      const tgt = nameToEntityId.get((change as unknown as { targetName?: string }).targetName || '')
        || change.targetEntityId;
      if (!src || !tgt) continue;
      let row = story.relationships.find(
        r => r.sourceEntityId === src && r.targetEntityId === tgt,
      );
      if (!row) {
        row = {
          id: uuid(), projectId,
          sourceEntityId: src, targetEntityId: tgt,
          relationType: change.reason || '互动',
          polarity: 0, strength: 0,
        };
        story.relationships.push(row);
      }
      row.polarity = clamp((row.polarity ?? 0) + (change.polarityDelta ?? 0), -1, 1);
      row.strength = clamp((row.strength ?? 0) + (change.strengthDelta ?? 0), 0, 1);
      if (change.reason) {
        row.evidence = [...(row.evidence || []), change.reason].slice(-8);
      }
      relationshipsTouched.push(row);
    }
  }

  // ---- Memories
  const memories: RuntimeMemory[] = [];
  for (const m of applied.memoryUpdates || []) {
    const scope = (m.scope || 'scene') as MemoryScope;
    let scopeId = m.scopeId;
    const named = (m as unknown as { scopeName?: string }).scopeName;
    if (!scopeId && named) {
      scopeId = nameToEntityId.get(named) || named;
    }
    if (!scopeId) continue;
    const mem: RuntimeMemory = {
      id: uuid(), projectId, scope, scopeId,
      content: m.content,
      importance: m.importance,
      createdAt: now,
    };
    memories.push(mem);
    try { await saveRuntimeMemory(mem); }
    catch (err) { console.warn('[state_updater] saveRuntimeMemory failed:', err); }
  }

  // ---- Conflicts
  const conflictsAdvanced: string[] = [];
  if (input.conflictStates && applied.conflictChanges) {
    for (const c of applied.conflictChanges) {
      const target = c.conflictId
        ? input.conflictStates.get(c.conflictId)
        : findConflictByTitle(input.conflictStates, (c as unknown as { title?: string }).title);
      if (!target) continue;
      if (c.newStage) target.stage = c.newStage;
      if (typeof c.intensityDelta === 'number') {
        target.intensity = clamp((target.intensity ?? 0) + c.intensityDelta, 0, 1);
      }
      if (c.note) target.notes = [...(target.notes || []), c.note].slice(-12);
      conflictsAdvanced.push(target.id);
    }
  }

  // ---- Timeline
  const timelineAppended: TimelineEvent[] = [];
  if (input.timelineEvents && applied.timelineUpdates) {
    const nextOrder = (input.timelineEvents.reduce(
      (m, e) => Math.max(m, e.orderIndex || 0), 0,
    )) + 1;
    let cursor = nextOrder;
    for (const t of applied.timelineUpdates) {
      const ev: TimelineEvent = {
        id: t.id || uuid(),
        projectId,
        title: t.title,
        description: t.description || '',
        orderIndex: cursor++,
        participants: t.participants || [],
        causes: t.causes || [],
        consequences: t.consequences || [],
      };
      input.timelineEvents.push(ev);
      timelineAppended.push(ev);
    }
  }

  // Persist the delta itself for replay/reflection.
  try { await saveStateDelta(applied); }
  catch (err) { console.warn('[state_updater] saveStateDelta failed:', err); }

  logEvent('state.delta_applied', {
    sceneId: applied.sceneId,
    relationships: relationshipsTouched.length,
    memories: memories.length,
    conflicts: conflictsAdvanced.length,
    timelineAppends: timelineAppended.length,
  });

  return {
    applied,
    memories,
    relationshipsTouched,
    conflictsAdvanced,
    timelineAppended,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function findConflictByTitle(
  states: Map<string, ConflictState>,
  title?: string,
): ConflictState | undefined {
  if (!title) return undefined;
  for (const s of states.values()) {
    if (s.title === title) return s;
  }
  return undefined;
}
