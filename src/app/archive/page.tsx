'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GameSave } from '@/lib/types';
import { loadSave } from '@/lib/storage';

function ArchiveContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saveId = searchParams.get('id');
  const [save, setSave] = useState<GameSave | null>(null);

  useEffect(() => {
    if (saveId) {
      const loaded = loadSave(saveId);
      setSave(loaded);
    }
  }, [saveId]);

  if (!save) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">找不到该存档</p>
          <button onClick={() => router.push('/')} className="text-accent hover:underline">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      <button onClick={() => router.push('/')} className="text-muted text-sm hover:text-foreground mb-6 block">
        &larr; 返回首页
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--accent)' }}>
          故事回顾
        </h1>
        <h2 className="text-xl text-foreground mb-2">{save.storyTitle}</h2>
        <div className="flex gap-4 text-sm text-muted">
          <span>{save.isCompleted ? '已完结' : '进行中'}</span>
          <span>·</span>
          <span>{save.narrativeHistory.length} 条记录</span>
          <span>·</span>
          <span>{new Date(save.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>

      {/* 交互记录 */}
      <div className="space-y-4">
        {save.narrativeHistory.map((entry, idx) => (
          <div key={entry.id} className="narrative-entry">
            {entry.type === 'narration' && (
              <div className="leading-relaxed text-foreground/90 bg-card-bg border border-card-border rounded-xl p-4">
                {entry.content.split('\n').map((line, i) => (
                  <p key={i} className="mb-2 last:mb-0">{line}</p>
                ))}
              </div>
            )}
            {entry.type === 'dialogue' && (
              <div className="flex gap-3 items-start bg-card-bg border border-card-border rounded-xl p-4">
                <span className="shrink-0 font-bold text-sm px-2 py-0.5 rounded bg-card-border">
                  {entry.speaker}
                </span>
                <p className="text-foreground/90 leading-relaxed">&ldquo;{entry.content}&rdquo;</p>
              </div>
            )}
            {entry.type === 'player-action' && (
              <div className="text-right">
                <span
                  className="inline-block px-4 py-2 rounded-xl text-sm"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                >
                  {entry.content}
                </span>
              </div>
            )}
            {entry.type === 'system' && (
              <div className="text-center text-xs text-muted py-2">
                {entry.content}
              </div>
            )}
            {/* 分支标记 */}
            {entry.choices?.some(c => c.isBranchPoint) && (
              <div className="text-center my-2">
                <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent">
                  关键分支点
                </span>
              </div>
            )}
            {/* 章节分隔 */}
            {idx > 0 && idx % 10 === 0 && (
              <div className="border-t border-card-border my-6" />
            )}
          </div>
        ))}
      </div>

      {/* 角色交互统计 */}
      {save.characterInteractions.length > 0 && (
        <div className="mt-10 bg-card-bg border border-card-border rounded-xl p-6">
          <h3 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">角色交互统计</h3>
          <div className="space-y-3">
            {save.characterInteractions.map(ci => {
              const posCount = ci.interactions.filter(i => i.sentiment === 'positive').length;
              const negCount = ci.interactions.filter(i => i.sentiment === 'negative').length;
              return (
                <div key={ci.characterId} className="flex items-center justify-between p-3 rounded-lg border border-card-border">
                  <div>
                    <span className="font-medium">{ci.characterName}</span>
                    <span className="text-sm text-muted ml-2">{ci.interactions.length} 次交互</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    {posCount > 0 && <span className="text-green-400">+{posCount}</span>}
                    {negCount > 0 && <span className="text-red-400">-{negCount}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 后日谈入口 */}
      {save.isCompleted && save.epilogue && (
        <button
          onClick={() => router.push(`/epilogue?id=${save.id}`)}
          className="w-full mt-6 py-3 rounded-xl font-medium text-sm transition-all"
          style={{ background: 'var(--accent)', color: 'black' }}
        >
          查看后日谈
        </button>
      )}
    </div>
  );
}

export default function ArchivePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center text-muted">
        加载中...
      </div>
    }>
      <ArchiveContent />
    </Suspense>
  );
}
