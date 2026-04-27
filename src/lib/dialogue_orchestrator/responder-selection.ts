/**
 * Responder selection — pick which agents should answer this turn.
 *
 * Used in two ways:
 *   1. As a prompt hint — the orchestrator can tell the LLM "agents X and
 *      Y are most likely to respond" to nudge generation, while still
 *      letting the model exercise judgement.
 *   2. As a downstream gate — Phase 6+ may filter or reorder the LLM's
 *      `npcResponses` against this selection if the model hallucinates a
 *      speaker who shouldn't be in scene.
 *
 * Heuristic, no LLM calls. Pure & cheap.
 */

import type { AgentProfile, Scene } from '../types';

export interface ResponderSelectionInput {
  scene?: Scene;
  agents: AgentProfile[];
  /** Names explicitly @-mentioned by the player. */
  mentioned?: string[];
  /** Names heuristically present (legacy fallback when no Scene record). */
  fallbackPresentNames?: string[];
  playerInput: string;
  /** Cap on responders. Default 3. */
  max?: number;
}

export interface ResponderSelection {
  /** Agent ids that should respond this turn, in priority order. */
  ids: string[];
  /** Names — convenience for prompt rendering. */
  names: string[];
  reasons: Record<string, 'mention' | 'input' | 'present' | 'goal'>;
}

export function selectResponders(input: ResponderSelectionInput): ResponderSelection {
  const max = input.max ?? 3;
  const ids: string[] = [];
  const names: string[] = [];
  const reasons: Record<string, 'mention' | 'input' | 'present' | 'goal'> = {};

  const presentSet = new Set(
    input.scene?.presentAgentIds.length
      ? input.scene.presentAgentIds
      : input.agents
          .filter(a => (input.fallbackPresentNames || []).includes(a.name))
          .map(a => a.id),
  );

  const add = (id: string, reason: 'mention' | 'input' | 'present' | 'goal') => {
    if (ids.includes(id) || ids.length >= max) return;
    const a = input.agents.find(x => x.id === id);
    if (!a) return;
    ids.push(id);
    names.push(a.name);
    reasons[id] = reason;
  };

  // 1. @ mentions take precedence — explicit player intent.
  for (const name of input.mentioned || []) {
    const a = input.agents.find(x => x.name === name);
    if (a) add(a.id, 'mention');
  }

  // 2. Names that appear in the player input, even without @.
  for (const a of input.agents) {
    if (input.playerInput.includes(a.name)) add(a.id, 'input');
  }

  // 3. Anyone in scene who hasn't been picked yet.
  for (const id of presentSet) add(id, 'present');

  // 4. As a last resort, characters whose goals match player input
  //    keywords (very crude — overlap test on goal phrases).
  if (ids.length < max) {
    const inputLower = input.playerInput.toLowerCase();
    for (const a of input.agents) {
      if (ids.includes(a.id)) continue;
      const hit = (a.goals || []).some(g => inputLower.includes(g.slice(0, 4)));
      if (hit) add(a.id, 'goal');
    }
  }

  return { ids, names, reasons };
}
