/**
 * Runtime-NPC types. An `AgentProfile` is the dialogue-time view of a
 * character: the LLM-facing card with goals/fears/secrets/behaviorRules.
 *
 * It pairs with `WorldEntity { type: 'character' }` via `entityId`. The
 * legacy `Character` type stays as the static-IP view used by the cast
 * sidebar and setup picker.
 *
 * Phase 1 only declares the shape. Phase 3 adds `agent_factory` to populate
 * it from extracted character entities.
 */

export interface AgentRelationshipRef {
  /** Other character's name — kept by-name so the prompt is still readable. */
  targetName: string;
  /** 'closest friend', 'business rival', etc. Free-form. */
  feeling?: string;
  /** One-sentence shared history, prompt-ready. */
  history?: string;
}

export interface AgentBehaviorRule {
  /** "When X happens"-style trigger phrasing (Chinese in current presets). */
  when: string;
  /** "...he will Y" — must read as imperative for the LLM to follow. */
  then: string;
}

export interface AgentProfile {
  id: string;
  projectId: string;
  /** FK to a WorldEntity of type 'character'. */
  entityId: string;
  /** Mirror of the source character name for quick lookup. */
  name: string;
  /** Optional canonical role like 'protagonist', 'mentor', 'antagonist'. */
  role?: string;
  /** Sentence-long persona summary used in detailed-injection lines. */
  persona: string;
  speechStyle?: string;
  goals?: string[];
  fears?: string[];
  /** Things the character would not voluntarily reveal. */
  secrets?: string[];
  relationshipMap?: AgentRelationshipRef[];
  /**
   * Initial memory items seeded from the world graph (canonical knowledge
   * the character is allowed to start with). Runtime memory accumulates on
   * top in `RuntimeMemory`.
   */
  memorySeed?: string[];
  /** Imperative rules the runtime injects into L2 of the dialogue prompt. */
  behaviorRules?: AgentBehaviorRule[];
  /**
   * Hard constraints — things the LLM absolutely must not do for this
   * character (typically authored by hand for tricky IPs).
   */
  constraints?: string[];
}

/**
 * Extension of the legacy player-identity shape. The blueprint asks for
 * `observer` / `transmigrator` types in addition to the existing
 * `soul-transfer` (canon character) and `reincarnation` (original). We
 * declare the union here; setup UI in Phase 3 wires it up.
 *
 * Rendered as a superset of `EntryMode` so old saves with
 * `entryMode: 'soul-transfer'` keep deserializing. The store's
 * `playerConfig` already carries the legacy `EntryMode`; UserIdentity is
 * the future shape that may eventually replace it.
 */
export type UserIdentityType =
  | 'canon_character'
  | 'original_character'
  | 'observer'
  | 'transmigrator';

export interface UserIdentity {
  id: string;
  projectId: string;
  type: UserIdentityType;
  name: string;
  description?: string;
  /** When the identity is a canon character, points back to the WorldEntity. */
  linkedEntityId?: string;
  /** Custom feeling overrides keyed by other entity id. */
  relationshipOverrides?: Record<string, string>;
  /** Free-form note about how the user enters the story. */
  narrativePosition?: string;
}
