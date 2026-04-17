'use client';

import {
  useEffect, useImperativeHandle, useRef, useState, forwardRef,
  KeyboardEvent as ReactKeyboardEvent, CSSProperties,
} from 'react';

export type MentionCandidate = {
  id: string;           // internal id — 'system' for the system, character.id otherwise
  name: string;         // display name (what shows inside the chip)
  kind: 'system' | 'character';
  interactable: boolean; // green dot if true, gray otherwise; system is always true
  hint?: string;         // subtle secondary text (e.g., character role)
};

/** Parsed output of the editor */
export type MentionParsed = {
  /** Plain text suitable for display (e.g., "@林宇 你好吗") */
  plainText: string;
  /** Mentions in the order they appear */
  mentions: { id: string; name: string; kind: 'system' | 'character' }[];
};

export type MentionInputHandle = {
  focus: () => void;
  clear: () => void;
  getParsed: () => MentionParsed;
};

type Props = {
  candidates: MentionCandidate[];
  placeholder?: string;
  disabled?: boolean;
  onSubmit: (parsed: MentionParsed) => void;
  onChange?: (parsed: MentionParsed) => void;
  /** Extra className appended to the editor */
  className?: string;
  style?: CSSProperties;
};

/**
 * Rich @-mention input powered by contenteditable. Type `@` to open a
 * candidate picker filtered by the query after the `@`. Arrow keys navigate,
 * Enter/Tab inserts a mention chip; Escape cancels.
 *
 * The chip is a non-editable <span> so Backspace deletes it atomically. On
 * submit (Enter without Shift and without an open picker), the editor is
 * serialized into { plainText, mentions[] }.
 */
export const MentionInput = forwardRef<MentionInputHandle, Props>(function MentionInput(
  { candidates, placeholder, disabled, onSubmit, onChange, className, style },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [popupAnchor, setPopupAnchor] = useState<{ top: number; left: number } | null>(null);
  const [currentMentions, setCurrentMentions] = useState<MentionParsed['mentions']>([]);
  /** DOM node of the `@` text currently being edited (if any). Used to replace on selection. */
  const draftRangeRef = useRef<{ textNode: Text; startOffset: number; endOffset: number } | null>(null);
  /** Track whether an IME composition is in progress to avoid intercepting Enter. */
  const isComposingRef = useRef(false);

  const hasSystemMention = currentMentions.some(m => m.kind === 'system');
  const hasCharacterMention = currentMentions.some(m => m.kind === 'character');

  const effectiveCandidates: MentionCandidate[] = candidates.map(c => {
    if (hasSystemMention && c.kind === 'character') {
      return { ...c, interactable: false, hint: '本回合已@系统' };
    }
    if (hasCharacterMention && c.kind === 'system') {
      return { ...c, interactable: false, hint: '本回合已@角色' };
    }
    return c;
  });

  const filtered = filterCandidates(effectiveCandidates, query);
  const restrictionBanner = hasSystemMention
    ? '系统咨询独立进行，本回合不可再 @ 角色'
    : hasCharacterMention
      ? '本回合已 @ 角色，不能再 @ 系统'
      : null;

  function nextSelectable(from: number, dir: 1 | -1): number {
    const n = filtered.length;
    if (n === 0) return 0;
    let i = from + dir;
    while (i >= 0 && i < n && !filtered[i].interactable) i += dir;
    if (i < 0 || i >= n) return from;
    return i;
  }
  function firstSelectable(): number {
    const i = filtered.findIndex(c => c.interactable);
    return i < 0 ? 0 : i;
  }

  function syncParsed() {
    const editor = editorRef.current;
    if (!editor) return { plainText: '', mentions: [] };
    const parsed = parseEditor(editor);
    setCurrentMentions(parsed.mentions);
    onChange?.(parsed);
    return parsed;
  }

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    clear: () => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        setCurrentMentions([]);
        onChange?.({ plainText: '', mentions: [] });
      }
    },
    getParsed: () => editorRef.current ? parseEditor(editorRef.current) : { plainText: '', mentions: [] },
  }), [onChange]);

  function closePopup() {
    setPopupOpen(false);
    setQuery('');
    setPopupAnchor(null);
    setSelectedIdx(0);
    draftRangeRef.current = null;
  }

  // Global click: close popup when clicking outside
  useEffect(() => {
    if (!popupOpen) return;
    const handler = (e: MouseEvent) => {
      const el = editorRef.current;
      const popup = document.getElementById('mention-popup-list');
      if (el?.contains(e.target as Node) || popup?.contains(e.target as Node)) return;
      closePopup();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popupOpen]);

  /**
   * After every input, detect whether the caret is in an @query draft.
   * If yes: update popup. If no: close popup.
   */
  function handleInput() {
    const editor = editorRef.current;
    if (!editor) return;
    syncParsed();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { closePopup(); return; }

    const textNode = node as Text;
    const text = textNode.textContent || '';
    const caret = range.startOffset;

    // Walk back from caret to find a preceding `@` before any whitespace
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(text[i]) && text[i] !== '@') i--;
    if (i < 0 || text[i] !== '@') { closePopup(); return; }

    // Require that @ is at the very start or preceded by whitespace (not mid-word)
    if (i > 0 && !/\s/.test(text[i - 1])) { closePopup(); return; }

    const q = text.slice(i + 1, caret);
    draftRangeRef.current = { textNode, startOffset: i, endOffset: caret };
    setQuery(prev => {
      if (prev !== q) setSelectedIdx(firstSelectable());
      return q;
    });
    setPopupOpen(true);

    // Position popup near the caret
    const rect = range.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    setPopupAnchor({
      top: rect.bottom - editorRect.top,
      left: rect.left - editorRect.left,
    });
  }

  function insertMention(candidate: MentionCandidate) {
    if (!candidate.interactable) return;
    const editor = editorRef.current;
    const draft = draftRangeRef.current;
    if (!editor || !draft) return;

    const { textNode, startOffset, endOffset } = draft;
    const text = textNode.textContent || '';
    const before = text.slice(0, startOffset);
    const after = text.slice(endOffset);

    // Replace the text node around @query with: [before][chip][space][after]
    const parent = textNode.parentNode;
    if (!parent) return;

    const beforeNode = document.createTextNode(before);
    const chip = buildChip(candidate);
    const afterNode = document.createTextNode(' ' + after);

    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(chip, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    // Place caret after the inserted space
    const range = document.createRange();
    range.setStart(afterNode, 1); // after the leading space
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    closePopup();
    syncParsed();
  }

  /**
   * If caret sits at the boundary of a chip and Backspace/Delete is pressed,
   * the default browser behaviour (contenteditable=false atoms) is
   * inconsistent — Chromium often no-ops the first keypress. Handle the
   * boundary case manually so deletion feels direct.
   */
  function tryDeleteAdjacentChip(direction: 'backward' | 'forward'): boolean {
    const editor = editorRef.current;
    if (!editor) return false;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    let target: Element | null = null;
    if (direction === 'backward') {
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = node.previousSibling;
        if (prev && (prev as Element).classList?.contains?.('mention-chip')) target = prev as Element;
      } else if (node === editor) {
        const prev = offset > 0 ? editor.childNodes[offset - 1] : null;
        if (prev && (prev as Element).classList?.contains?.('mention-chip')) target = prev as Element;
      }
    } else {
      if (node.nodeType === Node.TEXT_NODE && offset === (node.textContent?.length || 0)) {
        const next = node.nextSibling;
        if (next && (next as Element).classList?.contains?.('mention-chip')) target = next as Element;
      } else if (node === editor) {
        const next = editor.childNodes[offset];
        if (next && (next as Element).classList?.contains?.('mention-chip')) target = next as Element;
      }
    }
    if (!target) return false;
    target.remove();
    syncParsed();
    return true;
  }

  function handleEditorMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.classList?.contains('mention-chip-close')) {
      e.preventDefault();
      const chip = t.closest('.mention-chip') as HTMLElement | null;
      const editor = editorRef.current;
      if (chip && editor && editor.contains(chip)) {
        chip.remove();
        editor.focus();
        syncParsed();
      }
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Chip boundary deletion (when popup is closed)
    if (!popupOpen && (e.key === 'Backspace' || e.key === 'Delete')) {
      const removed = tryDeleteAdjacentChip(e.key === 'Backspace' ? 'backward' : 'forward');
      if (removed) { e.preventDefault(); return; }
    }
    // Enter submits when popup is closed and no IME composition
    if (popupOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => nextSelectable(i, 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => nextSelectable(i, -1)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered.length > 0 && filtered[selectedIdx]?.interactable) {
          e.preventDefault();
          insertMention(filtered[selectedIdx]);
        } else if (filtered.length > 0) {
          // selected item is disabled — eat the key, do nothing
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
    } else {
      if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const editor = editorRef.current;
        if (!editor) return;
        const parsed = parseEditor(editor);
        if (!parsed.plainText.trim()) return;
        onSubmit(parsed);
      }
    }
  }

  return (
    <div className="mention-input-wrap" style={{ position: 'relative', flex: 1 }}>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onMouseDown={handleEditorMouseDown}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={() => { isComposingRef.current = false; handleInput(); }}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        className={`textarea mention-editor ${className || ''}`}
        style={{ minHeight: 44, maxHeight: 160, overflowY: 'auto', whiteSpace: 'pre-wrap', ...style }}
      />
      {popupOpen && filtered.length > 0 && popupAnchor && (
        <div
          id="mention-popup-list"
          className="mention-popup surface-raised"
          style={{
            position: 'absolute',
            bottom: `calc(100% + 6px)`,
            left: Math.max(0, popupAnchor.left - 12),
            minWidth: 240,
            maxWidth: 340,
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 60,
          }}
        >
          {restrictionBanner && (
            <div className="mention-restriction-banner">
              {restrictionBanner}
            </div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              disabled={!c.interactable}
              onMouseDown={e => { e.preventDefault(); if (c.interactable) insertMention(c); }}
              onMouseEnter={() => { if (c.interactable) setSelectedIdx(i); }}
              className={`mention-option ${i === selectedIdx && c.interactable ? 'is-active' : ''} ${!c.interactable ? 'is-disabled' : ''}`}
              title={c.interactable ? '' : '不在当前场景，暂不可互动'}
            >
              <span className={`mention-status-dot ${c.interactable ? 'is-on' : ''}`} aria-hidden />
              <span className="avatar avatar-sm">
                {c.kind === 'system' ? '◎' : c.name[0]}
              </span>
              <span className="mention-option-body">
                <span className="mention-option-name">{c.name}</span>
                {c.hint && <span className="mention-option-hint">{c.hint}</span>}
              </span>
              {c.kind === 'system' && (
                <span className="chip" style={{ padding: '1px 8px', fontSize: '0.65rem' }}>不进对话</span>
              )}
              {!c.interactable && (
                <span className="chip" style={{ padding: '1px 8px', fontSize: '0.65rem', opacity: 0.7 }}>不在场</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildChip(c: MentionCandidate): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = `mention-chip ${c.kind === 'system' ? 'mention-chip-system' : 'mention-chip-character'}`;
  chip.setAttribute('contenteditable', 'false');
  chip.dataset.mentionId = c.id;
  chip.dataset.mentionName = c.name;
  chip.dataset.mentionKind = c.kind;

  const label = document.createElement('span');
  label.className = 'mention-chip-label';
  label.textContent = `@${c.name}`;

  const close = document.createElement('span');
  close.className = 'mention-chip-close';
  close.setAttribute('aria-label', '删除');
  close.setAttribute('role', 'button');
  close.textContent = '×';

  chip.append(label, close);
  return chip;
}

function filterCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter(c => c.name.toLowerCase().includes(q));
}

function parseEditor(editor: HTMLDivElement): MentionParsed {
  const mentions: MentionParsed['mentions'] = [];
  let plainText = '';
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const node = walker.currentNode;
  const visit = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      plainText += n.textContent || '';
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.classList?.contains('mention-chip')) {
        const name = el.dataset.mentionName
          || el.querySelector('.mention-chip-label')?.textContent?.replace(/^@/, '')
          || '';
        const id = el.dataset.mentionId || '';
        const kind = (el.dataset.mentionKind as 'system' | 'character') || 'character';
        plainText += `@${name}`;
        mentions.push({ id, name, kind });
        return;
      }
      if (el.tagName === 'BR') { plainText += '\n'; return; }
      if (el.tagName === 'DIV' && plainText && !plainText.endsWith('\n')) plainText += '\n';
    }
    for (const child of n.childNodes) visit(child);
  };
  void node;
  for (const child of editor.childNodes) visit(child);
  return { plainText: plainText.replace(/\n+$/, ''), mentions };
}
