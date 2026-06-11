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

  // 4. As a last resort, characters whose goals match player input.
  //    Bigram overlap (≥2 shared bigrams) works for both Chinese and English:
  //    avoids the substring false-matches that prefix-slice caused, and is
  //    case-insensitive by construction.
  if (ids.length < max) {
    const inputBigrams = toBigrams(input.playerInput);
    for (const a of input.agents) {
      if (ids.includes(a.id)) continue;
      const hit = (a.goals || []).some(g => goalMatchesBigrams(g, inputBigrams));
      if (hit) add(a.id, 'goal');
    }
  }

  return { ids, names, reasons };
}

/** Extract character bigrams from text after stripping punctuation/whitespace. */
function toBigrams(text: string): Set<string> {
  const chars = text.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const set = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

/**
 * Return true when goal shares enough bigrams with the precomputed input
 * bigram set. Short goals (≤3 net chars, e.g. 「复仇」) only yield 1-2
 * bigrams, so requiring 2 shared would make them unmatchable — they pass
 * with a single shared bigram instead.
 */
function goalMatchesBigrams(goal: string, inputBigrams: Set<string>): boolean {
  const goalChars = goal.toLowerCase().replace(/[\s\p{P}]/gu, '');
  if (goalChars.length < 2) return false;
  const required = goalChars.length <= 3 ? 1 : 2;
  let shared = 0;
  for (let i = 0; i + 1 < goalChars.length; i++) {
    if (inputBigrams.has(goalChars[i] + goalChars[i + 1])) {
      shared++;
      if (shared >= required) return true;
    }
  }
  return false;
}
