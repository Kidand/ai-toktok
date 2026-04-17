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
 *     top, then a bordered content block underneath. Each NPC has a stable
 *     color assigned via a simple name-hash so '林宇 = 珊瑚色' stays true
 *     across the whole playthrough.
 *   - Player actions render as a monospace `▸ command` banner in highlighter
 *     yellow — a deliberate mirror of a terminal prompt, making the player's
 *     agency visually distinct from everything else.
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
            const isPlayer = d.speaker === playerName;
            const isLastPartial = i === streamingDialogues.length - 1 && !!d.partial;
            if (isPlayer) {
              return (
                <div key={`s-${i}`} className="player-banner mb-3">
                  <span>
                    {d.content}
                    {isLastPartial && <span className="typing-cursor" />}
                  </span>
                </div>
              );
            }
            return (
              <div key={`s-${i}`} className="mb-3">
                <div className="speaker-tab" data-speaker-color={speakerColor(d.speaker || '')}>
                  {d.speaker || '…'}
                </div>
                <div className="dialogue-block">
                  {d.content
                    ? `"${d.content}${isLastPartial ? '' : '"'}`
                    : <span className="text-[var(--ink-muted)] italic font-sans text-sm">（正在开口…）</span>}
                  {isLastPartial && <span className="typing-cursor" />}
                </div>
              </div>
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
      const isPlayer = entry.speaker === playerName;
      if (isPlayer) {
        return (
          <div className="player-banner mb-3">
            <span>{entry.content}</span>
          </div>
        );
      }
      return (
        <div className="mb-3">
          <div className="speaker-tab" data-speaker-color={speakerColor(entry.speaker || '')}>
            {entry.speaker}
          </div>
          <div className="dialogue-block">&ldquo;{entry.content}&rdquo;</div>
        </div>
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

/** Palette for NPC speakers. Yellow reserved for CTAs, not speakers. */
const SPEAKER_COLORS = ['coral', 'cyan', 'mint', 'lilac', 'orange', 'pink', 'sky'] as const;

/** Deterministic hash-to-color so the same speaker keeps the same color. */
export function speakerColor(name: string): (typeof SPEAKER_COLORS)[number] {
  if (!name) return 'coral';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}
