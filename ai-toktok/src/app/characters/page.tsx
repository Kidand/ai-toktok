'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { Character } from '@/lib/types';

export default function CharactersPage() {
  const router = useRouter();
  const { parsedStory } = useGameStore();
  const [selected, setSelected] = useState<Character | null>(null);
  const [filter, setFilter] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>;
  }

  if (!parsedStory) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">请先上传故事</p>
          <button onClick={() => router.push('/')} className="text-accent hover:underline">返回首页</button>
        </div>
      </div>
    );
  }

  const characters = parsedStory.characters.filter(c =>
    !filter || c.name.includes(filter) || c.description.includes(filter)
  );

  const getRelationName = (charId: string) => {
    return parsedStory.characters.find(c => c.id === charId)?.name || '未知';
  };

  return (
    <div className="min-h-screen flex">
      {/* 左侧角色列表 */}
      <div className="w-80 border-r border-card-border bg-card-bg flex flex-col h-screen">
        <div className="p-4 border-b border-card-border">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => router.back()} className="text-muted text-sm hover:text-foreground">&larr;</button>
            <h1 className="font-bold" style={{ color: 'var(--accent)' }}>{parsedStory.title}</h1>
          </div>
          <p className="text-xs text-muted mb-3">{characters.length} 个角色</p>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="搜索角色..."
            className="w-full bg-input-bg border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {characters.map(char => (
            <button
              key={char.id}
              onClick={() => setSelected(char)}
              className={`w-full text-left px-4 py-3 border-b border-card-border transition-colors ${
                selected?.id === char.id
                  ? 'bg-accent/10 border-l-2 border-l-accent'
                  : 'hover:bg-card-border/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                >
                  {char.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{char.name}</div>
                  <p className="text-xs text-muted truncate">{char.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧角色详情 */}
      <div className="flex-1 h-screen overflow-y-auto">
        {selected ? (
          <div className="max-w-2xl mx-auto p-8">
            {/* 头部 */}
            <div className="flex items-center gap-4 mb-8">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
              >
                {selected.name[0]}
              </div>
              <div>
                <h2 className="text-2xl font-bold">{selected.name}</h2>
                <p className="text-muted">{selected.description}</p>
              </div>
            </div>

            {/* 性格 */}
            <section className="mb-6">
              <h3 className="text-sm font-medium text-muted mb-2 uppercase tracking-widest">性格</h3>
              <div className="bg-card-bg border border-card-border rounded-xl p-4 leading-relaxed">
                {selected.personality || '暂无描述'}
              </div>
            </section>

            {/* 背景 */}
            <section className="mb-6">
              <h3 className="text-sm font-medium text-muted mb-2 uppercase tracking-widest">背景</h3>
              <div className="bg-card-bg border border-card-border rounded-xl p-4 leading-relaxed">
                {selected.background || '暂无描述'}
              </div>
            </section>

            {/* 关系网 */}
            {selected.relationships.length > 0 && (
              <section className="mb-6">
                <h3 className="text-sm font-medium text-muted mb-2 uppercase tracking-widest">关系网络</h3>
                <div className="space-y-2">
                  {selected.relationships.map((rel, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const target = parsedStory.characters.find(c => c.id === rel.characterId);
                        if (target) setSelected(target);
                      }}
                      className="w-full flex items-center gap-3 bg-card-bg border border-card-border rounded-xl p-3 hover:border-accent/30 transition-colors text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                      >
                        {getRelationName(rel.characterId)[0]}
                      </div>
                      <div>
                        <span className="font-medium text-sm">{getRelationName(rel.characterId)}</span>
                        <span className="text-muted text-sm ml-2">{rel.relation}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 参与事件 */}
            {(() => {
              const events = parsedStory.keyEvents.filter(e =>
                e.involvedCharacterIds.includes(selected.id)
              );
              if (events.length === 0) return null;
              return (
                <section className="mb-6">
                  <h3 className="text-sm font-medium text-muted mb-2 uppercase tracking-widest">参与事件</h3>
                  <div className="space-y-2">
                    {events.map(event => (
                      <div key={event.id} className="bg-card-bg border border-card-border rounded-xl p-3">
                        <div className="font-medium text-sm">{event.title}</div>
                        <p className="text-xs text-muted mt-1">{event.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })()}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted">
            <p>选择一个角色查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
