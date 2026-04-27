/**
 * Deep interaction APIs.
 *
 * Each function:
 *   - is `async` and returns plain text (no JSON contract).
 *   - does NOT mutate `narrativeHistory` or persist anything.
 *   - calls `callLLMBrowser` once with a focused system prompt.
 *
 * Phase 7's Deep Interaction Panel (or any caller) imports these. The
 * orchestrator does NOT route them — they're side-channels by design.
 */

import { callLLMBrowser } from '../llm-browser';
import { stripThinking } from '../narrator-browser';
import {
  AGENT_INTERVIEW_SYSTEM, WORLD_QA_SYSTEM, IF_ELSE_SANDBOX_SYSTEM,
  RELATIONSHIP_EXPLAINER_SYSTEM, buildDeepInteractionContext,
} from '../prompts';
import { logEvent } from '../telemetry';
import type {
  AgentProfile, LLMConfig, NarrativeEntry, ParsedStory, PlayerConfig,
  StateDelta,
} from '../types';

/** Ask a single agent how they feel / what they think. */
export async function agentInterview(args: {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  agent: AgentProfile;
  question: string;
}): Promise<string> {
  const ctx = buildDeepInteractionContext({
    story: args.story, playerConfig: args.playerConfig,
    history: args.history, agent: args.agent,
  });
  const sys = AGENT_INTERVIEW_SYSTEM(args.agent.name) + '\n\n' + ctx;
  const raw = await callLLMBrowser(args.config, sys, args.question, {
    temperature: 0.7, maxTokens: 600,
  });
  logEvent('deep.interaction', { kind: 'agentInterview', agent: args.agent.name });
  return stripThinking(raw).trim();
}

/** Lookup-style world Q&A grounded in extracted lore + factions. */
export async function worldQA(args: {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  question: string;
}): Promise<string> {
  const ctx = buildDeepInteractionContext({
    story: args.story, playerConfig: args.playerConfig, history: args.history,
  });
  const sys = WORLD_QA_SYSTEM + '\n\n' + ctx;
  const raw = await callLLMBrowser(args.config, sys, args.question, {
    temperature: 0.3, maxTokens: 700,
  });
  logEvent('deep.interaction', { kind: 'worldQA' });
  return stripThinking(raw).trim();
}

/** Sandbox what-if. Marked clearly as parallel; main story unchanged. */
export async function ifElseSandbox(args: {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  hypothesis: string;
}): Promise<string> {
  const ctx = buildDeepInteractionContext({
    story: args.story, playerConfig: args.playerConfig, history: args.history,
  });
  const sys = IF_ELSE_SANDBOX_SYSTEM + '\n\n' + ctx;
  const raw = await callLLMBrowser(args.config, sys, args.hypothesis, {
    temperature: 0.8, maxTokens: 700,
  });
  logEvent('deep.interaction', { kind: 'ifElseSandbox' });
  return stripThinking(raw).trim();
}

/** Explain a recent relationship swing using StateDelta evidence. */
export async function explainRelationshipChange(args: {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  characterName: string;
  recentDeltas?: StateDelta[];
}): Promise<string> {
  const ctx = buildDeepInteractionContext({
    story: args.story, playerConfig: args.playerConfig, history: args.history,
  });
  const evidence = (args.recentDeltas || []).flatMap(d =>
    (d.relationshipChanges || []).map(c => `${c.sourceEntityId}→${c.targetEntityId} polarity${c.polarityDelta ?? 0} reason:${c.reason || ''}`),
  ).slice(-12).join('\n');
  const sys = RELATIONSHIP_EXPLAINER_SYSTEM + '\n\n' + ctx
    + (evidence ? `\n\n## StateDelta 证据\n${evidence}` : '');
  const userMsg = `请解释最近我和「${args.characterName}」之间关系的变化。`;
  const raw = await callLLMBrowser(args.config, sys, userMsg, {
    temperature: 0.5, maxTokens: 500,
  });
  logEvent('deep.interaction', { kind: 'explainRelationshipChange', name: args.characterName });
  return stripThinking(raw).trim();
}
