/**
 * reflection_reporter — in-flight "scene reflection" reports.
 *
 * Different from the epilogue:
 *   - Epilogue is per-character, terminal, first-person memoirs.
 *   - Reflection is system-level, mid-game, structured JSON. The play
 *     page surfaces it on-demand or every N turns.
 */

import { callLLMBrowser } from '../llm-browser';
import { extractFirstBalancedJSON, stripThinking } from '../narrator-browser';
import {
  REFLECTION_SYSTEM_PROMPT, buildReflectionUserMessage,
} from '../prompts';
import { logEvent } from '../telemetry';
import type {
  LLMConfig, NarrativeEntry, ParsedStory, PlayerConfig, StateDelta,
} from '../types';

export interface SceneReflection {
  summary: string;
  userImpact: string;
  relationshipChanges: { characterName: string; from?: string; to?: string; reason?: string }[];
  branchHints: string[];
  emotionalEcho: string;
  nextSceneSuggestions: { title: string; hook: string }[];
}

const EMPTY_REFLECTION: SceneReflection = {
  summary: '', userImpact: '', relationshipChanges: [],
  branchHints: [], emotionalEcho: '', nextSceneSuggestions: [],
};

/**
 * Build a transcript scoped to the last `windowTurns` player turns. We
 * count "turns" by player-action entries rather than message count so
 * the report stays anchored to player decisions rather than narration
 * volume.
 */
function buildReflectionTranscript(
  history: NarrativeEntry[],
  windowTurns: number,
  playerName: string,
): string {
  const turnIdxs: number[] = [];
  for (let i = history.length - 1; i >= 0 && turnIdxs.length < windowTurns; i--) {
    if (history[i].type === 'player-action') turnIdxs.unshift(i);
  }
  const startIdx = turnIdxs[0] ?? Math.max(0, history.length - windowTurns * 4);

  const lines: string[] = [];
  let turnNo = 0;
  for (let i = startIdx; i < history.length; i++) {
    const e = history[i];
    if (e.type === 'player-action') {
      turnNo++;
      lines.push(`【第 ${turnNo} 幕】${playerName}: ${e.content}`);
    } else if (e.type === 'narration') {
      const c = e.content || '';
      lines.push(`[叙事] ${c.length > 360 ? c.slice(0, 360) + '…' : c}`);
    } else if (e.type === 'dialogue') {
      lines.push(`${e.speaker}: "${e.content}"`);
    }
  }
  return lines.join('\n');
}

export interface GenerateSceneReflectionInput {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  /** How many player turns to include. Default 6. */
  windowTurns?: number;
  /** Recent state deltas — added as supporting evidence when present. */
  recentDeltas?: StateDelta[];
}

export async function generateSceneReflection(
  input: GenerateSceneReflectionInput,
): Promise<SceneReflection> {
  const { config, story, playerConfig, history, windowTurns = 6, recentDeltas } = input;
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const playerName = playerChar?.name || '旅人';

  const transcript = buildReflectionTranscript(history, windowTurns, playerName);
  if (!transcript.trim()) return EMPTY_REFLECTION;

  let userMessage = buildReflectionUserMessage(transcript, playerName);
  if (recentDeltas && recentDeltas.length > 0) {
    const summary = recentDeltas.flatMap(d => d.relationshipChanges || [])
      .slice(-8)
      .map(c => `${c.sourceEntityId}→${c.targetEntityId} ${c.polarityDelta ?? 0}`)
      .join('；');
    if (summary) userMessage += `\n\n## 最近 StateDelta 中的关系变化（参考）\n${summary}`;
  }

  const raw = await callLLMBrowser(
    config, REFLECTION_SYSTEM_PROMPT, userMessage,
    { temperature: 0.4, maxTokens: 1500 },
  );
  const cleaned = stripThinking(raw);
  const balanced = extractFirstBalancedJSON(cleaned) || cleaned;
  try {
    const parsed = JSON.parse(balanced) as Partial<SceneReflection>;
    const result: SceneReflection = {
      summary: parsed.summary || '',
      userImpact: parsed.userImpact || '',
      relationshipChanges: parsed.relationshipChanges || [],
      branchHints: parsed.branchHints || [],
      emotionalEcho: parsed.emotionalEcho || '',
      nextSceneSuggestions: parsed.nextSceneSuggestions || [],
    };
    logEvent('reflection.generated', {
      summaryChars: result.summary.length,
      relChanges: result.relationshipChanges.length,
      branches: result.branchHints.length,
      suggestions: result.nextSceneSuggestions.length,
    });
    return result;
  } catch (err) {
    console.warn('[reflection_reporter] failed to parse reflection JSON', err);
    return { ...EMPTY_REFLECTION, summary: cleaned.slice(0, 200) };
  }
}

/**
 * Convenience derived getters. They both call `generateSceneReflection`
 * and return slices — useful when the UI only wants one of the panels.
 */
export async function summarizeUserImpact(
  input: GenerateSceneReflectionInput,
): Promise<string> {
  const r = await generateSceneReflection(input);
  return r.userImpact;
}

export async function suggestNextNarrativeBranches(
  input: GenerateSceneReflectionInput,
): Promise<{ title: string; hook: string }[]> {
  const r = await generateSceneReflection(input);
  return r.nextSceneSuggestions;
}
