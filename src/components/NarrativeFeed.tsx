import { NarrativeEntry } from '@/lib/types';
import type { StreamingDialogue } from '@/lib/narrator-browser';

type Props = {
  entries: NarrativeEntry[];
  playerName?: string;
  streamingNarration?: string;
  streamingDialogues?: StreamingDialogue[];
  isGenerating?: boolean;
};

export function NarrativeFeed({
  entries, playerName, streamingNarration, streamingDialogues, isGenerating,
}: Props) {
  const hasStreaming = isGenerating && (
    (streamingNarration && streamingNarration.length > 0) ||
    (streamingDialogues && streamingDialogues.length > 0)
  );
  const narrationDone = !!(streamingDialogues && streamingDialogues.length > 0);

  return (
    <div className="space-y-5">
      {entries.map(entry => (
        <NarrativeBlock key={entry.id} entry={entry} playerName={playerName} />
      ))}
      {isGenerating && !hasStreaming && (
        <div className="anim-fade-in prose-story">
          <p className="text-muted italic">
            <span className="typing-cursor">正在书写</span>
          </p>
        </div>
      )}
      {hasStreaming && streamingNarration && (
        <div className="anim-fade-in prose-story">
          {streamingNarration.split('\n').map((line, i, arr) => (
            <p key={i}>
              {line}
              {i === arr.length - 1 && !narrationDone && <span className="typing-cursor" />}
            </p>
          ))}
        </div>
      )}
      {hasStreaming && streamingDialogues && streamingDialogues.map((d, i) => (
        <StreamingDialogueBubble
          key={`s-${i}`}
          dialogue={d}
          playerName={playerName}
          isLastAndPartial={i === streamingDialogues.length - 1 && !!d.partial}
        />
      ))}
    </div>
  );
}

function StreamingDialogueBubble({
  dialogue, playerName, isLastAndPartial,
}: { dialogue: StreamingDialogue; playerName?: string; isLastAndPartial: boolean }) {
  const isPlayer = dialogue.speaker === playerName;
  return (
    <div className={`anim-fade-in flex gap-3 items-start ${isPlayer ? 'flex-row-reverse' : ''}`}>
      <div className="avatar avatar-sm" aria-hidden>{dialogue.speaker?.[0] || '?'}</div>
      <div className={`max-w-[80%] ${isPlayer ? 'text-right' : ''}`}>
        <div className={`text-xs mb-1 font-sans ${isPlayer ? 'text-accent' : 'text-muted'}`}>
          {dialogue.speaker || '…'}
        </div>
        <div
          className={`inline-block text-left rounded-2xl px-4 py-2.5 leading-relaxed ${
            isPlayer
              ? 'bg-accent text-[#1a1208] font-medium'
              : 'bg-surface-2 border border-border text-foreground-soft'
          }`}
          style={isPlayer ? { background: 'linear-gradient(140deg, var(--accent-strong), var(--accent))' } : undefined}
        >
          {dialogue.content ? `"${dialogue.content}` : ''}
          {isLastAndPartial && <span className="typing-cursor" />}
          {dialogue.content && !isLastAndPartial && '"'}
          {!dialogue.content && isLastAndPartial && <span className="text-muted italic" style={{ fontSize: '0.85em' }}>（正在开口…）</span>}
        </div>
      </div>
    </div>
  );
}

function NarrativeBlock({ entry, playerName }: { entry: NarrativeEntry; playerName?: string }) {
  switch (entry.type) {
    case 'narration':
      return (
        <div className="anim-fade-in prose-story">
          {entry.content.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      );
    case 'dialogue': {
      const isPlayer = entry.speaker === playerName;
      return (
        <div className={`anim-fade-in flex gap-3 items-start ${isPlayer ? 'flex-row-reverse' : ''}`}>
          <div className={`avatar avatar-sm ${isPlayer ? '' : ''}`} aria-hidden>
            {entry.speaker?.[0] || '?'}
          </div>
          <div className={`max-w-[80%] ${isPlayer ? 'text-right' : ''}`}>
            <div className={`text-xs mb-1 font-sans ${isPlayer ? 'text-accent' : 'text-muted'}`}>
              {entry.speaker}
            </div>
            <div
              className={`inline-block text-left rounded-2xl px-4 py-2.5 leading-relaxed ${
                isPlayer
                  ? 'bg-accent text-[#1a1208] font-medium'
                  : 'bg-surface-2 border border-border text-foreground-soft'
              }`}
              style={isPlayer ? { background: 'linear-gradient(140deg, var(--accent-strong), var(--accent))' } : undefined}
            >
              &ldquo;{entry.content}&rdquo;
            </div>
          </div>
        </div>
      );
    }
    case 'player-action':
      return (
        <div className="anim-fade-in flex justify-end">
          <div
            className="max-w-[85%] inline-block px-4 py-2 rounded-2xl text-sm italic"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent-strong)',
              border: '1px dashed color-mix(in oklab, var(--accent) 40%, transparent)',
            }}
          >
            {entry.content}
          </div>
        </div>
      );
    case 'system':
      return (
        <div className="anim-fade-in text-center py-2">
          <span className="chip" style={{ fontStyle: 'italic' }}>{entry.content}</span>
        </div>
      );
    default:
      return null;
  }
}
