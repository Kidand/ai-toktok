'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GameSave } from '@/lib/types';
import { loadSave } from '@/lib/storage';
import { NarrativeFeed } from '@/components/NarrativeFeed';
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
          <p className="text-muted mb-4">找不到该存档</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const playerName = save.playerConfig.entryMode === 'soul-transfer'
    ? undefined // we don't have story here, will not highlight player dialogue bubble-style
    : save.playerConfig.customCharacter?.name;

  return (
    <div className="min-h-screen safe-top pb-12">
      {/* 顶栏 */}
      <div className="sticky top-0 z-20 glass border-b px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="text-sm text-muted font-sans">故事回顾</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
        {/* 封面信息 */}
        <header className="mb-8 text-center">
          <Book className="mx-auto mb-3" width={28} height={28} style={{ color: 'var(--accent)' }} />
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{save.storyTitle}</h1>
          <div className="flex items-center gap-2 justify-center flex-wrap text-xs">
            <span className={`chip ${save.isCompleted ? 'chip-teal' : 'chip-accent'}`}>
              {save.isCompleted ? '已完结' : '进行中'}
            </span>
            <span className="chip">{save.narrativeHistory.length} 条记录</span>
            <span className="chip">{new Date(save.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
        </header>

        {/* 叙事记录 */}
        <section className="mb-8">
          <NarrativeFeed entries={save.narrativeHistory} playerName={playerName} />
        </section>

        {/* 角色交互统计 */}
        {save.characterInteractions.length > 0 && (
          <section className="surface p-5 sm:p-6 mb-6">
            <h3 className="label mb-4">角色交互统计</h3>
            <div className="space-y-2">
              {save.characterInteractions.map(ci => {
                const pos = ci.interactions.filter(i => i.sentiment === 'positive').length;
                const neg = ci.interactions.filter(i => i.sentiment === 'negative').length;
                const neu = ci.interactions.length - pos - neg;
                const total = Math.max(1, ci.interactions.length);
                return (
                  <div key={ci.characterId} className="p-3 rounded-lg border border-border bg-surface-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="avatar avatar-sm">{ci.characterName[0]}</div>
                        <span className="font-medium truncate">{ci.characterName}</span>
                      </div>
                      <span className="text-xs text-muted font-sans shrink-0">{ci.interactions.length} 次</span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden flex">
                      {pos > 0 && <div style={{ background: 'var(--teal)', width: `${(pos / total) * 100}%` }} />}
                      {neu > 0 && <div style={{ background: 'var(--muted-dim)', width: `${(neu / total) * 100}%` }} />}
                      {neg > 0 && <div style={{ background: 'var(--danger)', width: `${(neg / total) * 100}%` }} />}
                    </div>
                    <div className="flex gap-3 mt-1.5 text-xs font-sans">
                      {pos > 0 && <span style={{ color: 'var(--teal)' }}>好感 {pos}</span>}
                      {neu > 0 && <span className="text-muted">中立 {neu}</span>}
                      {neg > 0 && <span style={{ color: 'var(--danger)' }}>嫌隙 {neg}</span>}
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
            查看后日谈
          </button>
        )}
      </main>
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>}>
      <ArchiveContent />
    </Suspense>
  );
}
