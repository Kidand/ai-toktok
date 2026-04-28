'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { GameSave, EpilogueEntry, StoryArcReport } from '@/lib/types';
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

  const [data, setData] = useState<{
    save: GameSave | null;
    epilogue: EpilogueEntry[];
    storyArc?: StoryArcReport;
  }>({ save: null, epilogue: [] });
  const [visibleCount, setVisibleCount] = useState(0);
  const [streamState, setStreamState] = useState<EpilogueStreamState | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generationTriggered = useRef(false);
  const { save, epilogue, storyArc } = data;

  useEffect(() => {
    let cancelled = false;
    const resolve = async (): Promise<GameSave | null> => {
      if (saveId) return await loadSave(saveId);
      const storeSaves = useGameStore.getState().saves;
      const currentSaveId = useGameStore.getState().currentSaveId;
      return storeSaves.find(s => s.id === currentSaveId) || null;
    };
    resolve().then((loaded) => {
      if (cancelled) return;
      if (loaded?.epilogue && loaded.epilogue.length > 0) {
        setData({ save: loaded, epilogue: loaded.epilogue, storyArc: loaded.storyArc });
      } else if (loaded) {
        setData(d => ({ ...d, save: loaded }));
      }
    });
    return () => { cancelled = true; };
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
    setStreamState({ phase: 'arc', entries: [], expectedCount: 0 });

    generateEpilogueBrowser(
      llmConfig, parsedStory, playerConfig,
      characterInteractions, narrativeHistory,
      (state) => setStreamState(state),
    )
      .then(result => {
        completeGame(result);
        setData(d => ({ ...d, epilogue: result.memoirs, storyArc: result.storyArc }));
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
  // Show the arc card whenever we have one — either freshly generated and
  // sitting in `streamState.arcReport`, or rehydrated from a save.
  const arcToShow: StoryArcReport | undefined = streamState?.arcReport || storyArc;

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

        {/* 故事弧摘要（旅程总结）——一旦 arcReport 出现就开始展示，
            随后开始流 memoirs 时仍保留在顶部 */}
        {arcToShow && <ArcSummaryCard arc={arcToShow} />}

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

        {/* memoirs 区段标题 —— 在 arc 显示完后再出现 */}
        {(isGenerating && streamState?.phase === 'memoirs') || hasEpilogue ? (
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <span className="stamp" style={{ transform: 'rotate(-1.5deg)' }}>MEMOIRS</span>
            <h3 className="display text-2xl">主要角色的回忆</h3>
          </div>
        ) : null}

        {/* 流式中的卡片 */}
        {isGenerating && streamState && streamState.entries.length > 0 && (
          <section className="space-y-6 mb-8">
            {streamState.entries.map((entry, idx) => {
              // While an entry is partial AND its characterName hasn't been
              // emitted yet (LLM put `memoir` before `characterName`), defer
              // showing the memoir text — otherwise the visible memoir will
              // appear to swap to a different speaker once the name finally
              // arrives. Once we have a name (even partial), it's safe to
              // stream both fields together.
              const safeMemoir = (entry.partial && !entry.characterName)
                ? ''
                : entry.memoir;
              // Use characterName as the React key once it's known so a
              // late-arriving name doesn't reuse a previous card's DOM.
              const key = entry.characterName
                ? `stream-name-${entry.characterName}-${idx}`
                : `stream-pending-${idx}`;
              return (
                <MemoirPostcard
                  key={key}
                  index={idx}
                  characterName={entry.characterName}
                  memoir={safeMemoir}
                  isPartial={!!entry.partial}
                />
              );
            })}
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
  // Arc phase: show an indeterminate "正在做旅程总结" placeholder with a
  // pulsing 25% bar so the user knows something's happening.
  if (state.phase === 'arc') {
    return (
      <div className="surface p-5 mb-6 anim-fade-in">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <div className="label-mono">PHASE 1 / 2</div>
            <p className="font-sans font-bold text-sm mt-0.5">
              正在为旅程做总结...
            </p>
          </div>
          <span className="font-mono text-lg font-bold tabular-nums bg-[var(--hi-cyan)] border-2 border-[var(--ink)] px-3 py-1" style={{ boxShadow: '2px 2px 0 var(--ink)' }}>
            起 · 承 · 转 · 合
          </span>
        </div>
        <div className="ticked-progress">
          <div className="ticked-progress-fill" style={{ width: '25%' }} />
        </div>
        <p className="text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
          {'// 把这场独有的旅程压缩成"起 / 承 / 转 / 合"四段式'}
        </p>
      </div>
    );
  }

  // Memoirs phase: completion-driven progress as before.
  const completedCount = state.entries.filter(e => !e.partial).length;
  const total = state.expectedCount;
  const pct = total > 0
    ? Math.min(99, (completedCount + (state.entries.some(e => e.partial) ? 0.5 : 0)) / total * 100)
    : Math.min(99, state.entries.length * 12);

  return (
    <div className="surface p-5 mb-6 anim-fade-in">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <div className="label-mono">PHASE 2 / 2 · GENERATING</div>
          <p className="font-sans font-bold text-sm mt-0.5">
            {completedCount === 0
              ? '正在召唤主要角色的回忆...'
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
        {'// 与玩家有 ≥5 轮交集且情感强度足够的角色，以第一人称写下回忆'}
      </p>
    </div>
  );
}

/**
 * Story-arc summary card. Shows the four phases (起承转合) in
 * sequence plus a row of stat chips. Survives reload because it's
 * persisted on `GameSave.storyArc`.
 */
function ArcSummaryCard({ arc }: { arc: StoryArcReport }) {
  const phases: { label: string; mark: string; body: string }[] = [
    { label: '起', mark: 'OPENING', body: arc.qi },
    { label: '承', mark: 'BUILD',   body: arc.cheng },
    { label: '转', mark: 'TURN',    body: arc.zhuan },
    { label: '合', mark: 'CLOSE',   body: arc.he },
  ].filter(p => p.body);

  return (
    <article className="surface-raised p-5 sm:p-6 mb-8 anim-slide-up"
             style={{ transform: 'rotate(-0.2deg)' }}>
      <header className="mb-4 pb-3 border-b-[2.5px] border-[var(--ink)] flex items-center gap-3 flex-wrap">
        <span className="stamp" style={{ transform: 'rotate(-1.5deg)' }}>STORY ARC</span>
        <h2 className="display text-xl sm:text-2xl">这场旅程的弧度</h2>
      </header>

      {phases.length > 0 ? (
        <ol className="list-none space-y-3 mb-5 pl-0">
          {phases.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-mono font-bold text-sm bg-[var(--ink)] text-[var(--paper)] px-2 py-1 shrink-0 rounded-[3px] h-fit">
                {p.label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="label-mono text-[10px] mb-1">{p.mark}</div>
                <p className="font-serif text-[15px] leading-relaxed">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="font-mono text-sm text-[var(--ink-muted)] mb-5">
          {'// 故事弧总结生成失败，以下为统计指标'}
        </p>
      )}

      <div className="border-t-[2px] border-[var(--ink)] pt-3">
        <div className="label-mono text-[10px] mb-2">JOURNEY METRICS</div>
        <div className="flex flex-wrap gap-2">
          <StatChip label="互动轮次" value={arc.stats.totalTurns} unit="轮" />
          <StatChip label="到访场景" value={arc.stats.locationsVisited} unit="处" />
          <StatChip label="对话角色" value={arc.stats.dialogueCharacters} unit="人" />
          <StatChip label="群体事件" value={arc.stats.groupSceneCount} unit="次" />
          <StatChip label="关系变动" value={arc.stats.relationshipShifts} unit="次"
                    accent={arc.stats.relationshipShifts > 0} />
        </div>
      </div>
    </article>
  );
}

function StatChip({ label, value, unit, accent }: { label: string; value: number; unit?: string; accent?: boolean }) {
  return (
    <span
      className={accent ? 'chip chip-accent' : 'chip'}
      style={{ padding: '4px 10px', fontSize: '0.78rem' }}
    >
      <span className="text-[var(--ink-muted)] font-mono">{label}</span>
      <span className="font-mono font-bold text-[var(--ink)] tabular-nums">
        {' '}{value}{unit || ''}
      </span>
    </span>
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
