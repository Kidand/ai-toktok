'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { GameSave, EpilogueEntry } from '@/lib/types';
import { loadSave } from '@/lib/storage';
import { generateEpilogueBrowser, type EpilogueStreamState } from '@/lib/narrator-browser';
import { ArrowLeft, Book, Sparkles } from '@/components/Icons';

function EpilogueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saveId = searchParams.get('id');
  const shouldGenerate = searchParams.get('generating') === '1';

  const { parsedStory, playerConfig, llmConfig, characterInteractions, narrativeHistory, completeGame } = useGameStore();

  const [data, setData] = useState<{ save: GameSave | null; epilogue: EpilogueEntry[] }>({ save: null, epilogue: [] });
  const [visibleCount, setVisibleCount] = useState(0);
  const [streamState, setStreamState] = useState<EpilogueStreamState | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generationTriggered = useRef(false);
  const { save, epilogue } = data;

  // Load existing epilogue (if any) from save or the store.
  useEffect(() => {
    let loaded: GameSave | null = null;
    if (saveId) {
      loaded = loadSave(saveId);
    } else {
      const storeSaves = useGameStore.getState().saves;
      const currentSaveId = useGameStore.getState().currentSaveId;
      loaded = storeSaves.find(s => s.id === currentSaveId) || null;
    }
    if (loaded?.epilogue && loaded.epilogue.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData({ save: loaded, epilogue: loaded.epilogue });
    } else if (loaded) {
      setData(d => ({ ...d, save: loaded }));
    }
  }, [saveId]);

  // If we arrived with ?generating=1 and no existing epilogue, run generation.
  useEffect(() => {
    if (generationTriggered.current) return;
    if (!shouldGenerate) return;
    if (epilogue.length > 0) return;
    if (!llmConfig || !parsedStory || !playerConfig) return;
    if (narrativeHistory.length === 0) return;

    generationTriggered.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGenerateError(null);
    setStreamState({ entries: [], expectedCount: 0 });

    generateEpilogueBrowser(
      llmConfig, parsedStory, playerConfig,
      characterInteractions, narrativeHistory,
      (state) => setStreamState(state),
    )
      .then(result => {
        completeGame(result);
        setData(d => ({ ...d, epilogue: result }));
        setStreamState(null);
        // strip the ?generating=1 so a refresh doesn't retrigger
        router.replace('/epilogue');
      })
      .catch(err => {
        console.error('生成后日谈失败:', err);
        setGenerateError(err instanceof Error ? err.message : '生成失败');
        setStreamState(null);
      });
  }, [shouldGenerate, epilogue.length, llmConfig, parsedStory, playerConfig,
      narrativeHistory, characterInteractions, completeGame, router]);

  // Once the full epilogue is settled, reveal cards one by one.
  useEffect(() => {
    if (epilogue.length > 0 && visibleCount < epilogue.length) {
      const timer = setTimeout(() => setVisibleCount(prev => prev + 1), 500);
      return () => clearTimeout(timer);
    }
  }, [epilogue.length, visibleCount]);

  const storyTitle = save?.storyTitle || parsedStory?.title || '未知故事';
  const playerChar = playerConfig?.entryMode === 'soul-transfer'
    ? parsedStory?.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig?.customCharacter;

  const isGenerating = !!streamState;
  const hasEpilogue = epilogue.length > 0;

  // Empty fallback when we have no data and aren't actively generating.
  if (!hasEpilogue && !isGenerating && !generateError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted mb-4">暂无后日谈数据</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen safe-top pb-12">
      {/* 顶栏 */}
      <div className="sticky top-0 z-20 glass border-b px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="text-sm text-muted font-sans">后日谈</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* 序 */}
        <header className="text-center py-10 sm:py-16">
          <Sparkles className="mx-auto mb-4" width={28} height={28} style={{ color: 'var(--accent)' }} />
          <h1 className="text-3xl sm:text-4xl font-bold mb-4"
              style={{
                background: 'linear-gradient(145deg, var(--accent-strong), var(--accent))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
            后日谈
          </h1>
          <p className="text-foreground-soft leading-relaxed">
            {storyTitle} · {playerChar?.name || '旅人'} 的旅程结束了
          </p>
          <p className="text-sm text-muted mt-2 italic">
            那些与你交错的命运，如今这样回忆着你...
          </p>
        </header>

        {/* 生成进度条 */}
        {isGenerating && streamState && (
          <EpilogueProgress state={streamState} />
        )}

        {/* 错误 */}
        {generateError && (
          <div className="surface p-5 mb-6" style={{ borderColor: 'color-mix(in oklab, var(--danger) 40%, transparent)' }}>
            <p className="text-sm mb-3" style={{ color: 'var(--danger)' }}>生成后日谈失败：{generateError}</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  generationTriggered.current = false;
                  setGenerateError(null);
                  router.replace('/epilogue?generating=1');
                }}
                className="btn btn-outline btn-sm">重试</button>
              <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm">返回首页</button>
            </div>
          </div>
        )}

        {/* 实时流式卡片（生成中） */}
        {isGenerating && streamState && streamState.entries.length > 0 && (
          <section className="space-y-5 mb-8">
            {streamState.entries.map((entry, idx) => (
              <MemoirCard
                key={`stream-${idx}`}
                characterName={entry.characterName}
                memoir={entry.memoir}
                isPartial={!!entry.partial}
              />
            ))}
          </section>
        )}

        {/* 已完成的回忆（完整展示阶段） */}
        {!isGenerating && hasEpilogue && (
          <section className="space-y-5">
            {epilogue.slice(0, visibleCount).map((entry, idx) => (
              <MemoirCard
                key={idx}
                characterName={entry.characterName}
                memoir={entry.memoir}
              />
            ))}

            {visibleCount < epilogue.length && (
              <div className="text-center py-6">
                <span className="text-muted italic typing-cursor font-sans text-sm">还有角色在回忆中</span>
              </div>
            )}
          </section>
        )}

        {/* 底部操作 */}
        {!isGenerating && hasEpilogue && visibleCount >= epilogue.length && (
          <footer className="mt-12 pt-8 border-t border-border anim-fade-in">
            <p className="text-center text-sm text-muted mb-6 italic">所有角色的回忆已经展开</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button onClick={() => {
                useGameStore.getState().resetGame();
                if (parsedStory) router.push('/setup');
              }} className="btn btn-outline">
                <Book width={16} height={16} />重读此故事
              </button>
              <button onClick={() => {
                useGameStore.getState().resetAll();
                router.push('/');
              }} className="btn btn-primary">
                <Sparkles width={16} height={16} />新故事
              </button>
              <button onClick={() => {
                const sid = saveId || useGameStore.getState().currentSaveId;
                if (sid) router.push(`/archive?id=${sid}`);
              }} className="btn btn-outline">
                存档回顾
              </button>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}

function EpilogueProgress({ state }: { state: EpilogueStreamState }) {
  const completedCount = state.entries.filter(e => !e.partial).length;
  const total = state.expectedCount;
  const pct = total > 0
    ? Math.min(99, (completedCount + (state.entries.some(e => e.partial) ? 0.5 : 0)) / total * 100)
    : Math.min(99, state.entries.length * 12);

  return (
    <div className="surface p-5 mb-6 anim-fade-in">
      <div className="flex items-center justify-between mb-3 font-sans text-sm">
        <span className="text-foreground-soft">
          {completedCount === 0
            ? '正在召唤各角色的回忆...'
            : `已完成 ${completedCount} / ${total || '?'} 位`}
        </span>
        <span className="text-accent tabular-nums text-xs">{Math.round(pct)}%</span>
      </div>
      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ background: 'linear-gradient(90deg, var(--accent-strong), var(--accent))', width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-dim mt-2 font-sans">
        每位角色会基于本次游玩经历以第一人称写下对你的回忆
      </p>
    </div>
  );
}

function MemoirCard({
  characterName, memoir, isPartial,
}: { characterName: string; memoir: string; isPartial?: boolean }) {
  return (
    <article className="surface-raised p-5 sm:p-6 anim-slide-up">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
        <div className="avatar avatar-md">{characterName?.[0] || '?'}</div>
        <div>
          <h3 className="font-bold">{characterName || '……'}</h3>
          <p className="text-xs text-muted font-sans">{isPartial ? '正在写下回忆…' : '的回忆'}</p>
        </div>
      </div>
      <div className="prose-story">
        {memoir.split('\n').map((line, i, arr) => (
          <p key={i}>
            {line}
            {isPartial && i === arr.length - 1 && <span className="typing-cursor" />}
          </p>
        ))}
      </div>
    </article>
  );
}

export default function EpiloguePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>}>
      <EpilogueContent />
    </Suspense>
  );
}
