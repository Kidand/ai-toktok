/**
 * dialogue_orchestrator — turn the per-turn loop into an explicit pipeline.
 *
 *   Observe   — gather scene + agents + history (caller assembles)
 *   Inject    — buildContextPackage (Phase 4)
 *   Decide    — selectResponders (Phase 5)
 *   Generate  — streamLLMBrowser, parsing the v2 JSON
 *   Update    — applyStateDelta (Phase 5)
 *
 * The legacy `streamNarrationBrowser` in `narrator-browser.ts` keeps its
 * shape; this module is the v2 path the future play page will adopt.
 */

import { v4 as uuid } from 'uuid';
import { streamLLMBrowser } from '../llm-browser';
import {
  buildContextPackage, type ContextTrace,
} from '../context_injector';
import {
  STATE_DELTA_OUTPUT_EXTENSION,
} from '../prompts';
import {
  extractFirstBalancedJSON, extractStreamingState, stripThinking,
  type StreamingState,
} from '../narrator-browser';
import { selectResponders, type ResponderSelection } from './responder-selection';
import { applyStateDelta, type ApplyStateDeltaResult } from '../state_updater';
import { logEvent } from '../telemetry';
import type {
  AgentProfile, ConflictState, GuardrailParams, LLMConfig, NarrativeBalance,
  NarrativeEntry, ParsedStory, PlayerConfig, Scene, StateDelta,
  TimelineEvent,
} from '../types';

export interface DialogueTurnInput {
  config: LLMConfig;
  story: ParsedStory;
  playerConfig: PlayerConfig;
  guardrail: GuardrailParams;
  balance: NarrativeBalance;
  scene?: Scene;
  agents: AgentProfile[];
  history: NarrativeEntry[];
  playerInput: string;
  mentionedCharacterNames?: string[];
  fallbackPresentNames?: string[];
  fromChoice?: boolean;
  /** Mutable runtime collections (the orchestrator updates them in place). */
  conflictStates?: Map<string, ConflictState>;
  timelineEvents?: TimelineEvent[];
  /** Streaming progress callback. */
  onStreamProgress?: (state: StreamingState) => void;
}

export interface DialogueTurnResult {
  raw: string;
  parsed: ParsedDialogueResponse;
  contextTrace: ContextTrace;
  responders: ResponderSelection;
  /** Set when `parsed.stateDelta` was non-empty and applyStateDelta ran. */
  stateUpdate?: ApplyStateDeltaResult;
}

export interface ParsedDialogueResponse {
  narration: string;
  /** Either v1 `dialogues[]` or v2 `npcResponses[]`, normalised. */
  dialogues: { speaker: string; content: string; emotion?: string; hiddenIntent?: string; action?: string }[];
  choices: { text: string; isBranchPoint: boolean }[];
  interactions: { characterName: string; event: string; reaction: string; sentiment: 'positive' | 'neutral' | 'negative' }[];
  /** Optional structured delta — when present, state_updater runs. */
  stateDelta?: Partial<StateDelta>;
}

/**
 * Run a complete dialogue turn end-to-end. Streams to `onStreamProgress`;
 * returns the parsed result + the trace + the side-effect summary.
 */
export async function runDialogueTurn(input: DialogueTurnInput): Promise<DialogueTurnResult> {
  const ctx = buildContextPackage({
    story: input.story,
    playerConfig: input.playerConfig,
    guardrail: input.guardrail,
    balance: input.balance,
    scene: input.scene,
    agents: input.agents,
    fallbackPresentNames: input.fallbackPresentNames,
    history: input.history,
    playerInput: input.playerInput,
    mentionedCharacterNames: input.mentionedCharacterNames,
    fromChoice: input.fromChoice,
  });

  const responders = selectResponders({
    scene: input.scene,
    agents: input.agents,
    mentioned: input.mentionedCharacterNames,
    fallbackPresentNames: input.fallbackPresentNames,
    playerInput: input.playerInput,
  });
  logEvent('context.built', {
    totalTokens: ctx.trace.totalTokens,
    layers: ctx.trace.layers.map(l => ({ k: l.layer, t: l.tokens, dropped: l.dropped })),
  });
  logEvent('dialogue.responders_selected', {
    names: responders.names,
    reasons: responders.reasons,
  });
  const responderHint = responders.names.length > 0
    ? `\n\n## 优先回应的角色\n${responders.names.join('、')}（运行时建议；最终是否发声仍由你判断）。`
    : '';

  const systemPrompt = ctx.systemPrompt + STATE_DELTA_OUTPUT_EXTENSION;
  const userMessage = ctx.userMessage + responderHint;

  let full = '';
  let lastSig = '';
  for await (const tok of streamLLMBrowser(input.config, systemPrompt, userMessage, {
    temperature: 0.3 + input.guardrail.temperature * 0.7,
    maxTokens: 4096,
  })) {
    full += tok;
    if (input.onStreamProgress) {
      const s = extractStreamingState(full);
      const sig = `${s.narration.length}@${s.dialogues.map(d => `${d.partial ? 'P' : 'F'}|${d.speaker}|${d.content.length}`).join('/')}`;
      if (sig !== lastSig) {
        lastSig = sig;
        input.onStreamProgress(s);
      }
    }
  }

  const parsed = parseDialogueResponse(full);

  let stateUpdate: ApplyStateDeltaResult | undefined;
  if (parsed.stateDelta && hasMeaningfulDelta(parsed.stateDelta) && input.scene) {
    const projectId = input.story.project?.id || input.story.id;
    stateUpdate = await applyStateDelta({
      projectId,
      delta: {
        ...parsed.stateDelta,
        sceneId: input.scene.id,
        messageId: uuid(),
      },
      story: input.story,
      conflictStates: input.conflictStates,
      timelineEvents: input.timelineEvents,
    });
  }

  logEvent('dialogue.completed', {
    narrationChars: parsed.narration.length,
    dialogues: parsed.dialogues.length,
    choices: parsed.choices.length,
    interactions: parsed.interactions.length,
    appliedDelta: Boolean(stateUpdate),
  });
  return { raw: full, parsed, contextTrace: ctx.trace, responders, stateUpdate };
}

function hasMeaningfulDelta(d: Partial<StateDelta>): boolean {
  return Boolean(
    (d.relationshipChanges && d.relationshipChanges.length) ||
    (d.memoryUpdates && d.memoryUpdates.length) ||
    (d.conflictChanges && d.conflictChanges.length) ||
    (d.timelineUpdates && d.timelineUpdates.length) ||
    (d.unlockedLoreEntries && d.unlockedLoreEntries.length),
  );
}

/**
 * Parse the LLM's JSON response, supporting both the legacy shape
 * (`dialogues` only) and the v2 shape (`npcResponses` + `stateDelta` +
 * `hiddenIntent`).
 */
export function parseDialogueResponse(raw: string): ParsedDialogueResponse {
  const cleaned = stripThinking(raw);
  let jsonStr = cleaned.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();
  else {
    const balanced = extractFirstBalancedJSON(cleaned);
    if (balanced) jsonStr = balanced;
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const dialogues = normaliseDialogues(parsed);
    const choices = ((parsed.choices as { text: string; isBranchPoint?: boolean }[]) || [])
      .map(c => ({ text: c.text, isBranchPoint: Boolean(c.isBranchPoint) }));
    const interactions = ((parsed.interactions as {
      characterName: string; event: string; reaction: string; sentiment: string;
    }[]) || []).map(i => ({
      characterName: i.characterName,
      event: i.event,
      reaction: i.reaction,
      sentiment: (i.sentiment as 'positive' | 'neutral' | 'negative') || 'neutral',
    }));
    const stateDelta = parsed.stateDelta as Partial<StateDelta> | undefined;
    return {
      narration: (parsed.narration as string) || '',
      dialogues,
      choices,
      interactions,
      stateDelta,
    };
  } catch {
    return {
      narration: cleaned,
      dialogues: [],
      choices: [
        { text: '继续观察', isBranchPoint: false },
        { text: '与附近的人交谈', isBranchPoint: false },
      ],
      interactions: [],
    };
  }
}

function normaliseDialogues(parsed: Record<string, unknown>):
  ParsedDialogueResponse['dialogues'] {
  // Prefer v2 npcResponses when present.
  const npc = parsed.npcResponses as undefined | Array<{
    speaker?: string; dialogue?: string; action?: string; emotion?: string; hiddenIntent?: string;
  }>;
  if (Array.isArray(npc) && npc.length > 0) {
    return npc.map(r => ({
      speaker: r.speaker || '',
      content: r.dialogue || '',
      action: r.action,
      emotion: r.emotion,
      hiddenIntent: r.hiddenIntent,
    }));
  }
  const v1 = parsed.dialogues as undefined | Array<{ speaker?: string; content?: string }>;
  return Array.isArray(v1)
    ? v1.map(d => ({ speaker: d.speaker || '', content: d.content || '' }))
    : [];
}

export { selectResponders } from './responder-selection';
export type { ResponderSelection } from './responder-selection';
