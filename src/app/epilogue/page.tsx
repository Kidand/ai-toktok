'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { GameSave, EpilogueEntry } from '@/lib/types';
import { loadSave } from '@/lib/storage';
import { ArrowLeft, Book, Sparkles } from '@/components/Icons';

function EpilogueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saveId = searchParams.get('id');

  const { parsedStory, playerConfig } = useGameStore();

  const [data, setData] = useState<{ save: GameSave | null; epilogue: EpilogueEntry[] }>({ save: null, epilogue: [] });
  const [visibleCount, setVisibleCount] = useState(0);
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
    if (loaded?.epilogue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData({ save: loaded, epilogue: loaded.epilogue });
    }
  }, [saveId]);

  useEffect(() => {
    if (epilogue.length > 0 && visibleCount < epilogue.length) {
      const timer = setTimeout(() => setVisibleCount(prev => prev + 1), 800);
      return () => clearTimeout(timer);
    }
  }, [epilogue.length, visibleCount]);

  if (!epilogue.length) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted mb-4">暂无后日谈数据</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const storyTitle = save?.storyTitle || parsedStory?.title || '未知故事';
  const playerChar = playerConfig?.entryMode === 'soul-transfer'
    ? parsedStory?.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig?.customCharacter;

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

        {/* 回忆 */}
        <section className="space-y-5">
          {epilogue.slice(0, visibleCount).map((entry, idx) => (
            <article key={idx} className="surface-raised p-5 sm:p-6 anim-slide-up">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border">
                <div className="avatar avatar-md">{entry.characterName[0]}</div>
                <div>
                  <h3 className="font-bold">{entry.characterName}</h3>
                  <p className="text-xs text-muted font-sans">的回忆</p>
                </div>
              </div>
              <div className="prose-story">
                {entry.memoir.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </article>
          ))}

          {visibleCount < epilogue.length && (
            <div className="text-center py-6">
              <span className="text-muted italic typing-cursor font-sans text-sm">还有角色在回忆中</span>
            </div>
          )}
        </section>

        {/* 底部 */}
        {visibleCount >= epilogue.length && (
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

export default function EpiloguePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>}>
      <EpilogueContent />
    </Suspense>
  );
}
