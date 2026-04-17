'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { GameSave, EpilogueEntry } from '@/lib/types';
import { loadSave } from '@/lib/storage';

function EpilogueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const saveId = searchParams.get('id');

  const { parsedStory, characterInteractions, narrativeHistory, playerConfig } = useGameStore();

  const [epilogue, setEpilogue] = useState<EpilogueEntry[]>([]);
  const [save, setSave] = useState<GameSave | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (saveId) {
      const loaded = loadSave(saveId);
      if (loaded?.epilogue) {
        setSave(loaded);
        setEpilogue(loaded.epilogue);
      }
    } else {
      // 从 store 获取（刚完成游戏的场景）
      const storeSaves = useGameStore.getState().saves;
      const currentSaveId = useGameStore.getState().currentSaveId;
      const currentSave = storeSaves.find(s => s.id === currentSaveId);
      if (currentSave?.epilogue) {
        setSave(currentSave);
        setEpilogue(currentSave.epilogue);
      }
    }
  }, [saveId]);

  // 逐条显示动画
  useEffect(() => {
    if (epilogue.length > 0 && visibleCount < epilogue.length) {
      const timer = setTimeout(() => {
        setVisibleCount(prev => prev + 1);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [epilogue.length, visibleCount]);

  if (!epilogue.length) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">暂无后日谈数据</p>
          <button onClick={() => router.push('/')} className="text-accent hover:underline">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const storyTitle = save?.storyTitle || parsedStory?.title || '未知故事';
  const playerChar = playerConfig?.entryMode === 'soul-transfer'
    ? parsedStory?.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig?.customCharacter;

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      <button onClick={() => router.push('/')} className="text-muted text-sm hover:text-foreground mb-6 block">
        &larr; 返回首页
      </button>

      {/* 标题 */}
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--accent)' }}>
          后日谈
        </h1>
        <p className="text-muted">
          {storyTitle} · {playerChar?.name || '旅人'}的旅程结束了
        </p>
        <p className="text-sm text-muted mt-1">
          那些与你交错的命运，如今这样回忆着你...
        </p>
      </div>

      {/* 后日谈内容 */}
      <div className="space-y-8">
        {epilogue.slice(0, visibleCount).map((entry, idx) => (
          <div
            key={idx}
            className="narrative-entry bg-card-bg border border-card-border rounded-xl p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
              >
                {entry.characterName[0]}
              </div>
              <div>
                <h3 className="font-bold">{entry.characterName}</h3>
                <p className="text-xs text-muted">的回忆</p>
              </div>
            </div>
            <div className="leading-relaxed text-foreground/85 pl-13">
              {entry.memoir.split('\n').map((line, i) => (
                <p key={i} className="mb-2 last:mb-0">{line}</p>
              ))}
            </div>
          </div>
        ))}

        {visibleCount < epilogue.length && (
          <div className="text-center py-8">
            <p className="text-muted italic typing-cursor">还有角色在回忆中...</p>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      {visibleCount >= epilogue.length && (
        <div className="mt-12 space-y-3">
          <div className="text-center text-muted text-sm mb-6">
            所有角色的回忆已经展开
          </div>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => {
                useGameStore.getState().resetGame();
                if (parsedStory) {
                  router.push('/setup');
                }
              }}
              className="py-3 rounded-xl font-medium text-sm border border-accent text-accent hover:bg-accent/10 transition-colors"
            >
              重读此故事
            </button>
            <button
              onClick={() => {
                useGameStore.getState().resetAll();
                router.push('/');
              }}
              className="py-3 rounded-xl font-medium text-sm transition-all"
              style={{ background: 'var(--accent)', color: 'black' }}
            >
              新故事
            </button>
            <button
              onClick={() => {
                const sid = saveId || useGameStore.getState().currentSaveId;
                if (sid) router.push(`/archive?id=${sid}`);
              }}
              className="py-3 rounded-xl font-medium text-sm border border-card-border text-foreground hover:border-accent/30 transition-colors"
            >
              存档回顾
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EpiloguePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center text-muted">
        加载中...
      </div>
    }>
      <EpilogueContent />
    </Suspense>
  );
}
