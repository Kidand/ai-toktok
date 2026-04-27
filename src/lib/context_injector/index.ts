/**
 * context_injector — explicit five-tier prompt builder.
 *
 * Public entry: `buildContextPackage(input)`. Returns the system prompt,
 * a recommended user message body, and a `ContextTrace` describing what
 * went into each layer (and what got trimmed).
 *
 * The dialogue orchestrator (Phase 5) will call this. The legacy path in
 * `narrator-browser.ts` keeps working in parallel — we only swap when
 * Phase 5 cuts over.
 */

import type {
  AgentProfile, GuardrailParams, NarrativeBalance, NarrativeEntry,
  ParsedStory, PlayerConfig, Scene,
} from '../types';
import { buildHistoryContext, MENTION_HINT_TEMPLATE, CHOICE_HINT } from '../prompts';
import { buildL0, buildL1, buildL2, buildL3, buildL4, type LayerResult } from './layers';
import { DEFAULT_BUDGET, type TokenBudget, estimateTokens, trimToBudget } from './budget';

export type LayerKey = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface LayerTrace {
  layer: LayerKey;
  surfaced: string[];
  /** Estimated tokens after trimming. */
  tokens: number;
  /** True if `trimToBudget` had to chop content to fit the per-layer cap. */
  trimmed: boolean;
  /** True if the composer dropped this layer to fit the total cap. */
  dropped?: boolean;
}

export interface ContextTrace {
  layers: LayerTrace[];
  totalTokens: number;
  budget: TokenBudget;
}

export interface ContextPackage {
  systemPrompt: string;
  userMessage: string;
  trace: ContextTrace;
}

export interface BuildContextInput {
  story: ParsedStory;
  playerConfig: PlayerConfig;
  guardrail: GuardrailParams;
  balance: NarrativeBalance;
  /** Active scene; pass `undefined` if none yet (legacy path). */
  scene?: Scene;
  /** All AgentProfile records visible to the runtime. */
  agents: AgentProfile[];
  /** Names the play page already considers "recently present" — used as
   *  a fallback when there is no Scene record. */
  fallbackPresentNames?: string[];
  history: NarrativeEntry[];
  playerInput: string;
  mentionedCharacterNames?: string[];
  fromChoice?: boolean;
  /** Override the default budget when needed. */
  budget?: Partial<TokenBudget>;
  /** Override the L4 scan window. Defaults to last 5 entries. */
  windowSize?: number;
  /** L3 expansion depth. 0 disables; 1 = direct neighbours; 2 = +second hop. */
  expandDepth?: 0 | 1 | 2;
}

export function buildContextPackage(input: BuildContextInput): ContextPackage {
  const {
    story, playerConfig, guardrail, balance, scene, agents,
    fallbackPresentNames = [],
    history, playerInput, mentionedCharacterNames, fromChoice,
    windowSize = 5,
    expandDepth = 1,
  } = input;
  const budget: TokenBudget = { ...DEFAULT_BUDGET, ...input.budget };

  const layers: { key: LayerKey; result: LayerResult; cap: number }[] = [
    { key: 'L0', result: buildL0(story, guardrail, balance), cap: budget.L0 },
    { key: 'L1', result: buildL1(story, playerConfig), cap: budget.L1 },
    {
      key: 'L2',
      result: buildL2(story, scene, agents, fallbackPresentNames),
      cap: budget.L2,
    },
    {
      key: 'L3',
      result: buildL3(
        story, agents,
        scene?.presentAgentIds || agents.filter(a => fallbackPresentNames.includes(a.name)).map(a => a.id),
        expandDepth,
      ),
      cap: budget.L3,
    },
    {
      key: 'L4',
      result: buildL4(story, history, playerInput, windowSize),
      cap: budget.L4,
    },
  ];

  // First pass: enforce per-layer caps via `trimToBudget`.
  const trimmedLayers = layers.map(({ key, result, cap }) => {
    const text = trimToBudget(result.text, cap);
    return {
      key, cap,
      text,
      surfaced: result.surfaced,
      trimmed: text !== result.text,
    };
  });

  // Second pass: total budget. Drop in reverse priority (L4 → L3 → L2 → L1).
  const priorityDrop: LayerKey[] = ['L4', 'L3', 'L2', 'L1'];
  let totalTokens = trimmedLayers.reduce((acc, l) => acc + estimateTokens(l.text), 0);
  const dropped = new Set<LayerKey>();
  for (const k of priorityDrop) {
    if (totalTokens <= budget.total) break;
    const target = trimmedLayers.find(l => l.key === k && l.text);
    if (!target) continue;
    totalTokens -= estimateTokens(target.text);
    target.text = '';
    dropped.add(k);
  }

  const systemPrompt = trimmedLayers
    .filter(l => l.text)
    .map(l => l.text)
    .join('\n\n');

  // User message: wrap recent history + player input + mention/choice hints.
  const historyContext = buildHistoryContext(history);
  const mentionHint = mentionedCharacterNames && mentionedCharacterNames.length > 0
    ? MENTION_HINT_TEMPLATE(mentionedCharacterNames)
    : '';
  const choiceHint = fromChoice ? CHOICE_HINT : '';
  const userMessage = historyContext
    ? `## 之前的剧情\n${historyContext}\n\n## 玩家当前行动\n${playerInput}${mentionHint}${choiceHint}`
    : `故事开始。玩家已进入故事世界。\n\n玩家的第一个行动：${playerInput || '（观察周围环境）'}${mentionHint}${choiceHint}`;

  const trace: ContextTrace = {
    budget,
    totalTokens,
    layers: trimmedLayers.map(l => ({
      layer: l.key,
      surfaced: l.surfaced,
      tokens: estimateTokens(l.text),
      trimmed: l.trimmed,
      dropped: dropped.has(l.key) || undefined,
    })),
  };

  return { systemPrompt, userMessage, trace };
}

export type { TokenBudget } from './budget';
export { DEFAULT_BUDGET } from './budget';
