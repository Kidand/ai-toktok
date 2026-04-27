/**
 * Barrel export for prompt templates.
 *
 * All user-facing prompt strings should live in this directory, not inline
 * inside business logic. Keeping them as data lets us:
 *   - diff prompt-only changes cleanly
 *   - bump cache versions when prompts change (parser-client.ts uses this)
 *   - swap prompts per "import goal" in Phase 7 (faithful / free-rewrite /
 *     companion / scenario)
 */

export {
  INITIAL_PARSE_PROMPT,
  buildIncrementalPrompt,
  POLISH_SYSTEM_PROMPT,
  type IncrementalGraphSnapshot,
} from './world-extraction';

export {
  buildWorldSystemPrompt,
  buildHistoryContext,
  MENTION_HINT_TEMPLATE,
  CHOICE_HINT,
  STATE_DELTA_OUTPUT_EXTENSION,
  type RenderedSelection,
} from './dialogue-runtime';

export { buildSystemHintPrompt } from './system-hint';

export {
  EPILOGUE_SYSTEM_PROMPT,
  buildEpilogueUserMessage,
  type EpilogueUserMessageInput,
} from './epilogue';

export {
  REINCARNATION_SYSTEM_PROMPT,
  buildReincarnationUserMessage,
  AGENT_PERSONA_SYSTEM_PROMPT,
} from './agent-persona';

export {
  REFLECTION_SYSTEM_PROMPT,
  buildReflectionUserMessage,
} from './reflection';

export {
  AGENT_INTERVIEW_SYSTEM,
  WORLD_QA_SYSTEM,
  IF_ELSE_SANDBOX_SYSTEM,
  RELATIONSHIP_EXPLAINER_SYSTEM,
  buildDeepInteractionContext,
  type DeepInteractionContextInput,
} from './deep-interaction';

export { importGoalModifier } from './import-goal';

export {
  STORY_ARC_SYSTEM_PROMPT,
  buildStoryArcUserMessage,
  type StoryArcUserMessageInput,
} from './story-arc';
