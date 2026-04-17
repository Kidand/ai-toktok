'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GameSave } from '@/lib/types';
import { loadSave } from '@/lib/storage';
import { NarrativeFeed, speakerColor } from '@/components/NarrativeFeed';
import { ArrowLeft, Book } from '@/components/Icons';

function ArchiveContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saveId = searchParams.get('id');
  const [save, setSave] = useState<GameSave | null>(null);

  useEffect(() => {
    if (saveId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSave(loadSave(saveId));
    }
  }, [saveId]);

  if (!save) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[var(--ink-muted)] mb-4 font-mono">找不到该存档</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const playerName = save.playerConfig.entryMode === 'soul-transfer'
    ? undefined
    : save.playerConfig.customCharacter?.name;

  const turnCount = save.narrativeHistory.filter(e => e.type === 'player-action').length;

  return (
    <div className="min-h-screen safe-top pb-12">
      {/* Sticky top */}
      <div className="sticky top-0 z-20 glass px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="label-mono">ARCHIVE · 故事回顾</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-8">
        {/* 封面 */}
        <header className="mb-10">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="stamp" style={{ transform: 'rotate(-1.5deg)' }}>ISSUE RE-READ</span>
            <Book width={16} height={16} style={{ color: 'var(--ink)' }} />
          </div>
          <h1 className="display text-3xl sm:text-5xl mb-4">{save.storyTitle}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`chip ${save.isCompleted ? 'chip-mint' : 'chip-accent'}`}>
              {save.isCompleted ? '已完结' : '进行中'}
            </span>
            <span className="chip">{turnCount} turns</span>
            <span className="chip">{save.narrativeHistory.length} 条记录</span>
            <span className="chip font-mono">{new Date(save.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
        </header>

        {/* 叙事 */}
        <section className="mb-10">
          <NarrativeFeed entries={save.narrativeHistory} playerName={playerName} />
        </section>

        {/* 统计 */}
        {save.characterInteractions.length > 0 && (
          <section className="surface p-5 sm:p-6 mb-6">
            <div className="mb-4 flex items-baseline gap-3">
              <span className="label-mono">STATS</span>
              <h3 className="font-sans font-bold text-base">角色交互统计</h3>
            </div>
            <div className="space-y-3">
              {save.characterInteractions.map(ci => {
                const pos = ci.interactions.filter(i => i.sentiment === 'positive').length;
                const neg = ci.interactions.filter(i => i.sentiment === 'negative').length;
                const neu = ci.interactions.length - pos - neg;
                const total = Math.max(1, ci.interactions.length);
                return (
                  <div key={ci.characterId} className="p-3 border-[2px] border-[var(--ink)] bg-[var(--paper-raised)]" style={{ borderRadius: 'var(--radius-xs)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="avatar avatar-sm" data-speaker-color={speakerColor(ci.characterName)}>{ci.characterName[0]}</div>
                        <span className="font-sans font-bold truncate">{ci.characterName}</span>
                      </div>
                      <span className="text-xs font-mono text-[var(--ink-muted)] shrink-0">{ci.interactions.length} 次</span>
                    </div>
                    <div className="h-3 border-2 border-[var(--ink)] flex" style={{ borderRadius: '2px' }}>
                      {pos > 0 && <div style={{ background: 'var(--hi-mint)', width: `${(pos / total) * 100}%` }} />}
                      {neu > 0 && <div style={{ background: 'var(--ink-faint)', width: `${(neu / total) * 100}%` }} />}
                      {neg > 0 && <div style={{ background: 'var(--hi-coral)', width: `${(neg / total) * 100}%` }} />}
                    </div>
                    <div className="flex gap-3 mt-1.5 text-[11px] font-mono">
                      {pos > 0 && <span className="text-[var(--hi-mint)]" style={{ filter: 'brightness(0.6)' }}>+ 好感 {pos}</span>}
                      {neu > 0 && <span className="text-[var(--ink-muted)]">中立 {neu}</span>}
                      {neg > 0 && <span style={{ color: 'var(--hi-coral)', filter: 'brightness(0.85)' }}>- 嫌隙 {neg}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {save.isCompleted && save.epilogue && (
          <button onClick={() => router.push(`/epilogue?id=${save.id}`)}
                  className="btn btn-primary btn-lg btn-block">
            查看后日谈 →
          </button>
        )}
      </main>
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">加载中...</div>}>
      <ArchiveContent />
    </Suspense>
  );
}
