/**
 * agent_factory — turn world entities into runtime AgentProfile records.
 *
 * Two paths:
 *   - `agentProfileFromCharacter()` is heuristic-only. It rearranges the
 *     existing `Character` fields (personality / background / relationships)
 *     into the AgentProfile shape so old saves and presets can adopt the
 *     new model without an extra LLM round-trip. Quality is good enough for
 *     L2 detailed injection.
 *   - `enrichAgentProfileLLM()` calls the AGENT_PERSONA prompt to fill in
 *     goals / fears / secrets / behaviorRules. Opt-in — used by the
 *     build-preset script and the "deepen NPC" feature in Phase 6.
 *
 * Both produce a record that can be persisted via
 * `storage.saveAgent(agent)` (Phase 1) or kept transient on `ParsedStory.agents`.
 */

import { v4 as uuid } from 'uuid';
import { callLLMBrowser } from '../llm-browser';
import { stripThinking, extractFirstBalancedJSON } from '../narrator-browser';
import { logEvent } from '../telemetry';
import {
  AGENT_PERSONA_SYSTEM_PROMPT,
} from '../prompts';
import type {
  AgentBehaviorRule, AgentProfile, AgentRelationshipRef,
  Character, LLMConfig, ParsedStory,
} from '../types';

/**
 * Heuristic path. Reuses the source character's prose; doesn't invent
 * goals/fears/secrets — leaves those empty so callers can later choose to
 * enrich via LLM.
 */
export function agentProfileFromCharacter(
  projectId: string,
  character: Character,
  story?: ParsedStory,
): AgentProfile {
  const persona = (character.description || character.personality || '').slice(0, 160);
  const speechStyle = inferSpeechStyle(character);
  const relationshipMap: AgentRelationshipRef[] = (character.relationships || [])
    .map((r): AgentRelationshipRef | null => {
      const target = story?.characters.find(c => c.id === r.characterId);
      return target ? {
        targetName: target.name,
        feeling: r.relation,
      } : null;
    })
    .filter((x): x is AgentRelationshipRef => x !== null);

  return {
    id: uuid(),
    projectId,
    entityId: character.id,
    name: character.name,
    persona: persona || character.name,
    speechStyle,
    goals: [],
    fears: [],
    secrets: [],
    relationshipMap,
    memorySeed: character.background ? [character.background] : [],
    behaviorRules: [],
  };
}

/**
 * Lightweight heuristic — peeks at adjective vocabulary in `personality`
 * and produces a one-line speech-style note. Good enough as a default; the
 * LLM enrichment path will overwrite when invoked.
 */
function inferSpeechStyle(c: Character): string {
  const p = (c.personality || '').toLowerCase();
  if (/沉默|寡言|内向/.test(c.personality || '')) return '寡言少语，多用短句和省略';
  if (/暴躁|易怒|急躁/.test(c.personality || '')) return '语速快、用词锐利、容易拔高';
  if (/温和|温柔|平静/.test(c.personality || '')) return '语调平和、句子完整、避免冲突';
  if (/狡黠|狡猾|心机/.test(c.personality || '')) return '言辞迂回，话里藏话';
  if (p) return '与性格相符的自然口吻';
  return '中性日常口吻';
}

/**
 * Build profiles for every non-player character in the story. Returns
 * heuristic-only profiles. Caller may then iterate and selectively call
 * `enrichAgentProfileLLM` for the highest-importance ones.
 */
export function createAgentsFromWorld(story: ParsedStory): AgentProfile[] {
  const projectId = story.project?.id || story.id;
  const out = story.characters.map(c => agentProfileFromCharacter(projectId, c, story));
  logEvent('agent.created', { projectId, count: out.length, mode: 'heuristic' });
  return out;
}

/**
 * LLM enrichment. Sends the character's known fields and merges
 * goals/fears/secrets/behaviorRules onto an existing heuristic profile.
 * Idempotent — re-runs overwrite the LLM-generated fields but keep the
 * heuristic-derived `relationshipMap` and `memorySeed`.
 */
export async function enrichAgentProfileLLM(
  config: LLMConfig,
  base: AgentProfile,
  source: Character,
  story: ParsedStory,
): Promise<AgentProfile> {
  const userMessage = JSON.stringify({
    name: source.name,
    description: source.description,
    personality: source.personality,
    background: source.background,
    knownRelationships: base.relationshipMap,
    storyContext: {
      title: story.title,
      genre: story.worldSetting.genre,
      era: story.worldSetting.era,
      tone: story.worldSetting.toneDescription,
    },
  }, null, 2);
  const raw = await callLLMBrowser(
    config, AGENT_PERSONA_SYSTEM_PROMPT, userMessage,
    { temperature: 0.6, maxTokens: 1500 },
  );
  const cleaned = stripThinking(raw);
  const balanced = extractFirstBalancedJSON(cleaned) || cleaned;
  let parsed: {
    persona?: string;
    speechStyle?: string;
    goals?: string[];
    fears?: string[];
    secrets?: string[];
    behaviorRules?: (string | AgentBehaviorRule)[];
    relationshipMap?: AgentRelationshipRef[];
  } = {};
  try {
    parsed = JSON.parse(balanced);
  } catch (err) {
    console.warn('[agent_factory] failed to parse persona JSON; keeping heuristic profile.', err);
    return base;
  }

  const enriched: AgentProfile = {
    ...base,
    persona: parsed.persona || base.persona,
    speechStyle: parsed.speechStyle || base.speechStyle,
    goals: parsed.goals || base.goals,
    fears: parsed.fears || base.fears,
    secrets: parsed.secrets || base.secrets,
    behaviorRules: normalizeBehaviorRules(parsed.behaviorRules) || base.behaviorRules,
    // Keep heuristic relationshipMap when LLM omits — it's grounded in the IP.
    relationshipMap: parsed.relationshipMap?.length
      ? parsed.relationshipMap
      : base.relationshipMap,
  };
  logEvent('agent.enriched', {
    name: enriched.name,
    goals: enriched.goals?.length || 0,
    fears: enriched.fears?.length || 0,
    secrets: enriched.secrets?.length || 0,
    behaviorRules: enriched.behaviorRules?.length || 0,
  });
  return enriched;
}

/** Coerce LLM behaviorRules into the structured `{when, then}` shape. */
function normalizeBehaviorRules(
  raw: (string | AgentBehaviorRule)[] | undefined,
): AgentBehaviorRule[] | undefined {
  if (!raw) return undefined;
  return raw.map(r => {
    if (typeof r === 'string') {
      const m = r.match(/^(?:当|If)\s*(.+?)[，,]\s*(?:就|then)\s*(.+)$/);
      if (m) return { when: m[1].trim(), then: m[2].trim() };
      return { when: '', then: r };
    }
    return { when: r.when || '', then: r.then || '' };
  }).filter(r => r.when || r.then);
}
