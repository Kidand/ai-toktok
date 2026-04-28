/**
 * Cast resolution helper.
 *
 * The reincarnation flow lets the player invent a brand-new character at
 * runtime. That character lives on `playerConfig.customCharacter` but is
 * NOT baked into the preset's `parsedStory.characters` (we don't want
 * one player's run to pollute the shared preset row in IndexedDB).
 *
 * Every place that needs to render the "cast" — the character page, the
 * world overview / relationship graph, the play sidebar — should read
 * through this helper instead of `story.characters` directly. It folds
 * the reincarnation character into the list (deduped by id) and is a
 * no-op for soul-transfer playthroughs.
 */

import type { Character, ParsedStory, PlayerConfig, Relationship } from './types';

export function getDisplayCharacters(
  story: ParsedStory,
  playerConfig: PlayerConfig | null,
): Character[] {
  const base = story.characters;
  if (
    playerConfig?.entryMode === 'reincarnation'
    && playerConfig.customCharacter
    && !base.some(c => c.id === playerConfig.customCharacter!.id)
  ) {
    // Reincarnated character goes first — they're the player's avatar.
    return [playerConfig.customCharacter, ...base];
  }
  return base;
}

/**
 * Merge the preset's Phase 2 relationship table with synthesized entries
 * for the reincarnation character. The reincarnation generator emits
 * relationships keyed by target character name; setup/page maps those to
 * canonical ids and stores them on `customCharacter.relationships`. The
 * RelationshipGraph prefers the Phase 2 table when present, so to make
 * the new edges visible we have to splice them in here.
 */
export function getDisplayRelationships(
  story: ParsedStory,
  playerConfig: PlayerConfig | null,
): Relationship[] | undefined {
  const base = story.relationships;
  if (
    playerConfig?.entryMode !== 'reincarnation'
    || !playerConfig.customCharacter
    || !playerConfig.customCharacter.relationships?.length
  ) {
    return base;
  }
  const projectId = story.project?.id || story.id;
  const player = playerConfig.customCharacter;
  const synthesized: Relationship[] = player.relationships.map((r, i) => ({
    id: `reincarnation-rel-${player.id}-${i}`,
    projectId,
    sourceEntityId: player.id,
    targetEntityId: r.characterId,
    relationType: r.relation,
    polarity: r.polarity,
    strength: r.strength,
  }));
  // If the preset has no Phase 2 table at all, RelationshipGraph would
  // normally fall back to legacy embeddings — but only the reincarnation
  // character has those new fields. To keep edges between preset cast
  // members visible alongside the new ones, also synthesize legacy edges
  // for the rest of the cast when no Phase 2 table exists.
  if (!base || base.length === 0) {
    const legacyEdges: Relationship[] = [];
    for (const c of story.characters) {
      for (const rel of c.relationships || []) {
        legacyEdges.push({
          id: `legacy-rel-${c.id}-${rel.characterId}-${legacyEdges.length}`,
          projectId,
          sourceEntityId: c.id,
          targetEntityId: rel.characterId,
          relationType: rel.relation,
          polarity: rel.polarity,
          strength: rel.strength,
        });
      }
    }
    return [...legacyEdges, ...synthesized];
  }
  return [...base, ...synthesized];
}
