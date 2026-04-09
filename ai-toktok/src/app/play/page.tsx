'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { NarrativeEntry } from '@/lib/types';

export default function PlayPage() {
  const router = useRouter();
  const {
    parsedStory, playerConfig, llmConfig, isPlaying,
    narrativeHistory, guardrailParams, narrativeBalance,
    addNarrativeEntries, addPlayerAction, addCharacterInteractions,
    autoSave, completeGame, setIsGenerating, isGenerating,
    characterInteractions,
  } = useGameStore();

  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [narrativeHistory, streamingText]);

  // SSE streaming helper
  const streamNarrate = useCallback(async (action: string, playerInput?: string) => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    setIsGenerating(true);
    setStreamingText('');

    try {
      const res = await fetch('/api/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          config: llmConfig,
          story: parsedStory,
          playerConfig,
          guardrail: guardrailParams,
          balance: narrativeBalance,
          history: narrativeHistory,
          playerInput: playerInput || '',
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'token') {
              accumulated += evt.token;
              setStreamingText(accumulated);
            } else if (evt.type === 'done') {
              setStreamingText('');
              addNarrativeEntries(evt.entries);
              if (evt.interactions?.length) {
                addCharacterInteractions(evt.interactions);
              }
              autoSave();
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      console.error('叙事生成失败:', err);
    } finally {
      setIsGenerating(false);
      setStreamingText('');
    }
  }, [llmConfig, parsedStory, playerConfig, guardrailParams, narrativeBalance, narrativeHistory, addNarrativeEntries, addCharacterInteractions, autoSave, setIsGenerating]);

  // 生成开场
  const generateOpening = useCallback(async () => {
    if (!llmConfig || !parsedStory || !playerConfig || narrativeHistory.length > 0) return;
    await streamNarrate('opening');
  }, [llmConfig, parsedStory, playerConfig, narrativeHistory.length, streamNarrate]);

  useEffect(() => {
    if (isPlaying && narrativeHistory.length === 0 && !isGenerating) {
      generateOpening();
    }
  }, [isPlaying, narrativeHistory.length, isGenerating, generateOpening]);

  if (!parsedStory || !playerConfig || !isPlaying) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">请先完成故事设置</p>
          <button onClick={() => router.push('/')} className="text-accent hover:underline">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? parsedStory.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;

  const handleSendInput = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isGenerating || !llmConfig) return;

    setInput('');
    addPlayerAction(msg);
    await streamNarrate('narrate', msg);
  };

  const handleChoiceClick = (choiceText: string) => {
    handleSendInput(choiceText);
  };

  const handleEndStory = async () => {
    if (!llmConfig) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/epilogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: llmConfig,
          story: parsedStory,
          playerConfig,
          characterInteractions,
          narrativeHistory,
        }),
      });
      const data = await res.json();
      completeGame(data.epilogue);
      router.push('/epilogue');
    } catch (err) {
      console.error('生成后日谈失败:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendInput();
    }
  };

  // 获取最后一条带选项的记录
  const lastChoices = [...narrativeHistory].reverse().find(e => e.choices?.length)?.choices;

  return (
    <div className="h-screen flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-card-border bg-card-bg/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-muted text-sm hover:text-foreground">
            &larr;
          </button>
          <div>
            <h1 className="font-bold text-sm" style={{ color: 'var(--accent)' }}>{parsedStory.title}</h1>
            <p className="text-xs text-muted">
              {playerChar?.name || '旅人'} · {playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="text-muted text-sm hover:text-foreground px-2 py-1 rounded"
          >
            角色
          </button>
          <button
            onClick={handleEndStory}
            disabled={isGenerating || narrativeHistory.length < 4}
            className="text-sm px-3 py-1.5 rounded-lg border border-card-border text-muted hover:text-foreground hover:border-accent/30 transition-colors disabled:opacity-30"
          >
            结束故事
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 主叙事区 */}
        <div className="flex-1 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            {narrativeHistory.map((entry) => (
              <NarrativeEntryView key={entry.id} entry={entry} playerName={playerChar?.name} />
            ))}
            {isGenerating && (
              <div className="narrative-entry leading-relaxed text-foreground/90">
                {streamingText ? (
                  streamingText.split('\n').map((line, i) => (
                    <p key={i} className="mb-2">{line}<span className="typing-cursor" /></p>
                  ))
                ) : (
                  <p className="text-muted italic typing-cursor">正在书写...</p>
                )}
              </div>
            )}
          </div>

          {/* 选项区 */}
          {lastChoices && lastChoices.length > 0 && !isGenerating && (
            <div className="px-6 pb-2 flex flex-wrap gap-2">
              {lastChoices.map(choice => (
                <button
                  key={choice.id}
                  onClick={() => handleChoiceClick(choice.text)}
                  className={`px-4 py-2 rounded-lg text-sm border transition-all hover:border-accent/50 ${
                    choice.isBranchPoint
                      ? 'border-accent/40 bg-accent/5 branch-indicator'
                      : 'border-card-border bg-card-bg'
                  }`}
                >
                  {choice.text}
                </button>
              ))}
            </div>
          )}

          {/* 输入区 */}
          <div className="px-6 py-4 border-t border-card-border bg-card-bg/50">
            <div className="flex gap-3 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="你想做什么..."
                rows={1}
                disabled={isGenerating}
                className="flex-1 bg-input-bg border border-card-border rounded-xl px-4 py-3 text-foreground text-sm resize-none focus:outline-none focus:border-accent disabled:opacity-50"
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
              <button
                onClick={() => handleSendInput()}
                disabled={!input.trim() || isGenerating}
                className="px-5 py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-30"
                style={{ background: 'var(--accent)', color: 'black' }}
              >
                行动
              </button>
            </div>
          </div>
        </div>

        {/* 侧边栏 - 角色列表 */}
        {showSidebar && (
          <div className="w-72 border-l border-card-border bg-card-bg overflow-y-auto p-4">
            <h2 className="text-sm font-medium text-muted mb-3 uppercase tracking-widest">角色</h2>
            <div className="space-y-3">
              {parsedStory.characters.map(char => {
                const interaction = characterInteractions.find(ci => ci.characterId === char.id);
                return (
                  <div key={char.id} className="p-3 rounded-lg border border-card-border">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {char.name}
                      {char.id === playerConfig.characterId && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">你</span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-1 line-clamp-2">{char.personality}</p>
                    {interaction && (
                      <p className="text-xs mt-2" style={{ color: 'var(--accent)' }}>
                        {interaction.interactions.length} 次互动
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NarrativeEntryView({ entry, playerName }: { entry: NarrativeEntry; playerName?: string }) {
  switch (entry.type) {
    case 'narration':
      return (
        <div className="narrative-entry leading-relaxed text-foreground/90">
          {entry.content.split('\n').map((line, i) => (
            <p key={i} className="mb-2">{line}</p>
          ))}
        </div>
      );
    case 'dialogue':
      return (
        <div className="narrative-entry flex gap-3 items-start">
          <span
            className="shrink-0 font-bold text-sm px-2 py-0.5 rounded"
            style={{
              color: entry.speaker === playerName ? 'var(--accent)' : 'var(--foreground)',
              background: entry.speaker === playerName ? 'var(--accent-dim)' : 'var(--card-border)',
            }}
          >
            {entry.speaker}
          </span>
          <p className="text-foreground/90 leading-relaxed">&ldquo;{entry.content}&rdquo;</p>
        </div>
      );
    case 'player-action':
      return (
        <div className="narrative-entry text-right">
          <span className="inline-block px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            {entry.content}
          </span>
        </div>
      );
    case 'system':
      return (
        <div className="narrative-entry text-center text-xs text-muted py-2">
          {entry.content}
        </div>
      );
    default:
      return null;
  }
}
