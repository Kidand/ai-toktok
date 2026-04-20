import { NarrativeEntry } from '@/lib/types';
import type { StreamingDialogue } from '@/lib/narrator-browser';

type Props = {
  entries: NarrativeEntry[];
  playerName?: string;
  streamingNarration?: string;
  streamingDialogues?: StreamingDialogue[];
  isGenerating?: boolean;
};

/**
 * Visual-structure-forward narrative view:
 *   - Every new turn (boundary marked by a 'player-action' entry, or start)
 *     gets a labeled divider like `── T03 ───────`.
 *   - Narration flows as serif prose.
 *   - NPC dialogue renders as a folder-tab block: a colored speaker tab on
 *     top (left-aligned), then a bordered content block underneath. Each
 *     NPC has a stable name-hash color so '林宇 = 珊瑚色' stays true across
 *     the playthrough.
 *   - Player *dialogue* (in-story speech) mirrors the NPC form but the
 *     whole block is right-aligned with a yellow tab — visually the
 *     mirror of the NPC speaker block, so the reader sees whose voice
 *     spoke whom.
 *   - Player *action* (typed/clicked intent) renders as a monospace
 *     `▸ command` banner in highlighter yellow — distinct from dialogue,
 *     it's the player's out-of-world agency, not their in-world speech.
 */
export function NarrativeFeed({
  entries, playerName, streamingNarration, streamingDialogues, isGenerating,
}: Props) {
  const turns = groupIntoTurns(entries);

  const hasStreaming = isGenerating && (
    (streamingNarration && streamingNarration.length > 0) ||
    (streamingDialogues && streamingDialogues.length > 0)
  );
  const narrationDone = !!(streamingDialogues && streamingDialogues.length > 0);

  const lastFinishedTurnN = turns.length;
  const streamingTurnN = lastFinishedTurnN + (isGenerating ? 1 : 0);

  return (
    <div>
      {turns.map((turn, idx) => (
        <TurnBlock
          key={idx}
          turnNumber={idx + 1}
          entries={turn}
          playerName={playerName}
        />
      ))}

      {/* Streaming / pending turn */}
      {isGenerating && (
        <div className="anim-fade-in">
          <div className="turn-divider">T{String(streamingTurnN).padStart(2, '0')} · 正在书写</div>

          {!hasStreaming && (
            <div className="prose-story">
              <span className="typing-cursor">正在书写</span>
            </div>
          )}

          {hasStreaming && streamingNarration && (
            <div className="prose-story mb-4">
              {streamingNarration.split('\n').map((line, i, arr) => (
                <p key={i}>
                  {line}
                  {i === arr.length - 1 && !narrationDone && <span className="typing-cursor" />}
                </p>
              ))}
            </div>
          )}

          {hasStreaming && streamingDialogues && streamingDialogues.map((d, i) => {
            const isLastPartial = i === streamingDialogues.length - 1 && !!d.partial;
            // Skip dialogues that never received any content (neither speaker
            // nor body) — they're usually LLM artifacts or completed-but-empty
            // rows that would render as a dangling tab.
            if (!d.speaker && !d.content) return null;
            // Skip completed-but-empty dialogues (tab with no content).
            if (!isLastPartial && !d.content) return null;
            return (
              <DialogueBlock
                key={`s-${i}`}
                speaker={d.speaker}
                content={d.content}
                isPlayer={d.speaker === playerName}
                playerName={playerName}
                streaming={isLastPartial}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function TurnBlock({
  turnNumber, entries, playerName,
}: { turnNumber: number; entries: NarrativeEntry[]; playerName?: string }) {
  return (
    <div className="anim-fade-in">
      <div className="turn-divider">T{String(turnNumber).padStart(2, '0')}</div>
      {entries.map(entry => (
        <NarrativeBlock key={entry.id} entry={entry} playerName={playerName} />
      ))}
    </div>
  );
}

function NarrativeBlock({ entry, playerName }: { entry: NarrativeEntry; playerName?: string }) {
  switch (entry.type) {
    case 'narration':
      return (
        <div className="prose-story mb-4">
          {entry.content.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      );
    case 'dialogue': {
      // Skip dialogues with no meaningful payload (LLM artifacts).
      if (!entry.content && !entry.speaker) return null;
      if (!entry.content) return null;
      return (
        <DialogueBlock
          speaker={entry.speaker}
          content={entry.content}
          isPlayer={entry.speaker === playerName}
          playerName={playerName}
        />
      );
    }
    case 'player-action':
      return (
        <div className="player-banner mb-3">
          <span>{entry.content}</span>
        </div>
      );
    case 'system':
      return <div className="system-line mb-3">{entry.content}</div>;
    default:
      return null;
  }
}

/**
 * Shared dialogue renderer for both committed and streaming entries.
 * Player dialogues mirror the NPC form to the right and use the yellow
 * (player) speaker color, keeping parity with NPCs while staying
 * visually distinct from the monospace player-action banner.
 */
function DialogueBlock({
  speaker, content, isPlayer, playerName, streaming,
}: {
  speaker?: string;
  content: string;
  isPlayer: boolean;
  playerName?: string;
  streaming?: boolean;
}) {
  const displaySpeaker = speaker || (isPlayer ? playerName : '…') || '…';
  const color = isPlayer ? 'yellow' : speakerColor(speaker || '');
  const tabClass = isPlayer ? 'speaker-tab speaker-tab-player' : 'speaker-tab';
  const blockClass = isPlayer ? 'dialogue-block dialogue-block-player' : 'dialogue-block';
  const outerClass = isPlayer ? 'mb-3 flex flex-col items-end' : 'mb-3';
  return (
    <div className={outerClass}>
      <div className={tabClass} data-speaker-color={color}>
        {displaySpeaker}
        {isPlayer && <span className="speaker-tab-you">你</span>}
      </div>
      <div className={blockClass}>
        &ldquo;{content}
        {streaming && <span className="typing-cursor" />}
        {!streaming && '"'}
      </div>
    </div>
  );
}

/**
 * A turn is: everything from a `player-action` up to (but not including) the
 * next `player-action`. The first turn covers the opening narration before
 * the player has done anything.
 */
function groupIntoTurns(entries: NarrativeEntry[]): NarrativeEntry[][] {
  const turns: NarrativeEntry[][] = [];
  let current: NarrativeEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'player-action' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/** Palette for NPC speakers. Yellow reserved for CTAs / the player, never NPCs. */
const SPEAKER_COLORS = ['coral', 'cyan', 'mint', 'lilac', 'orange', 'pink', 'sky'] as const;

/** Deterministic hash-to-color so the same speaker keeps the same color. */
export function speakerColor(name: string): (typeof SPEAKER_COLORS)[number] {
  if (!name) return 'coral';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}
