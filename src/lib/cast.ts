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

import type { Character, ParsedStory, PlayerConfig } from './types';

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
