'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { GameSave, EpilogueEntry } from '@/lib/types';
import { loadSave } from '@/lib/storage';
import { generateEpilogueBrowser, type EpilogueStreamState } from '@/lib/narrator-browser';
import { speakerColor } from '@/components/NarrativeFeed';
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
        router.replace('/epilogue');
      })
      .catch(err => {
        console.error('生成后日谈失败:', err);
        setGenerateError(err instanceof Error ? err.message : '生成失败');
        setStreamState(null);
      });
  }, [shouldGenerate, epilogue.length, llmConfig, parsedStory, playerConfig,
      narrativeHistory, characterInteractions, completeGame, router]);

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

  if (!hasEpilogue && !isGenerating && !generateError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[var(--ink-muted)] mb-4 font-mono">暂无后日谈数据</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen safe-top pb-12">
      <div className="sticky top-0 z-20 glass px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="label-mono">POSTSCRIPT · 后日谈</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* 序 */}
        <header className="py-10 sm:py-14">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="stamp" style={{ transform: 'rotate(-2deg)' }}>END OF RUN</span>
            <span className="stamp" style={{ transform: 'rotate(1.5deg)', background: 'var(--hi-yellow)' }}>
              those who remember
            </span>
          </div>
          <h1 className="display text-4xl sm:text-6xl leading-[0.92] mb-5">
            后日谈
          </h1>
          <p className="font-serif text-lg text-[var(--ink-soft)] leading-relaxed">
            <span className="font-sans font-bold">{storyTitle}</span> · {playerChar?.name || '旅人'} 的旅程结束了。
            <br />
            那些与你交错的命运，如今这样回忆着你。
          </p>
        </header>

        {/* 生成进度 */}
        {isGenerating && streamState && (
          <EpilogueProgress state={streamState} />
        )}

        {/* 错误 */}
        {generateError && (
          <div className="surface p-5 mb-6" style={{ boxShadow: '4px 4px 0 var(--hi-coral)' }}>
            <p className="font-mono text-sm mb-3 text-[var(--ink)]">
              ⚠ 生成后日谈失败：{generateError}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  generationTriggered.current = false;
                  setGenerateError(null);
                  router.replace('/epilogue?generating=1');
                }}
                className="btn btn-primary btn-sm">重试</button>
              <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm">返回首页</button>
            </div>
          </div>
        )}

        {/* 流式中的卡片 */}
        {isGenerating && streamState && streamState.entries.length > 0 && (
          <section className="space-y-6 mb-8">
            {streamState.entries.map((entry, idx) => (
              <MemoirPostcard
                key={`stream-${idx}`}
                index={idx}
                characterName={entry.characterName}
                memoir={entry.memoir}
                isPartial={!!entry.partial}
              />
            ))}
          </section>
        )}

        {/* 完成后的卡片 */}
        {!isGenerating && hasEpilogue && (
          <section className="space-y-6">
            {epilogue.slice(0, visibleCount).map((entry, idx) => (
              <MemoirPostcard
                key={idx}
                index={idx}
                characterName={entry.characterName}
                memoir={entry.memoir}
              />
            ))}

            {visibleCount < epilogue.length && (
              <div className="system-line py-4">
                <span className="typing-cursor">还有角色在回忆</span>
              </div>
            )}
          </section>
        )}

        {/* 底部 */}
        {!isGenerating && hasEpilogue && visibleCount >= epilogue.length && (
          <footer className="mt-12 pt-8 border-t-[2.5px] border-[var(--ink)] anim-fade-in">
            <div className="system-line mb-6">所有角色的回忆已经展开</div>
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
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <div className="label-mono">GENERATING</div>
          <p className="font-sans font-bold text-sm mt-0.5">
            {completedCount === 0
              ? '正在召唤各角色的回忆...'
              : `已完成 ${completedCount} / ${total || '?'} 位`}
          </p>
        </div>
        <span className="font-mono text-lg font-bold tabular-nums bg-[var(--hi-yellow)] border-2 border-[var(--ink)] px-3 py-1" style={{ boxShadow: '2px 2px 0 var(--ink)' }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="ticked-progress">
        <div className="ticked-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
        {'// 每位角色基于本次游玩经历以第一人称写下对你的回忆'}
      </p>
    </div>
  );
}

function MemoirPostcard({
  index, characterName, memoir, isPartial,
}: { index: number; characterName: string; memoir: string; isPartial?: boolean }) {
  const color = speakerColor(characterName || '');
  const tiltDeg = [-0.35, 0.25, -0.15, 0.4, -0.3, 0.18][index % 6];
  return (
    <article className="surface-raised p-5 sm:p-6 anim-slide-up"
             style={{ transform: `rotate(${tiltDeg}deg)` }}>
      <div className="flex items-start gap-3 mb-4 pb-3 border-b-[2.5px] border-[var(--ink)]">
        <div className="avatar avatar-lg" data-speaker-color={color}>{characterName?.[0] || '?'}</div>
        <div className="flex-1 min-w-0">
          <div className="label-mono mb-1">FROM</div>
          <h3 className="display text-xl sm:text-2xl truncate">{characterName || '……'}</h3>
          <p className="text-xs font-mono text-[var(--ink-muted)] mt-0.5">
            {isPartial ? '// 正在写下回忆…' : '// 的回忆'}
          </p>
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
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">加载中...</div>}>
      <EpilogueContent />
    </Suspense>
  );
}
