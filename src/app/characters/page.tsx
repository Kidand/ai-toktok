'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { Character } from '@/lib/types';
import { ArrowLeft, Search } from '@/components/Icons';

export default function CharactersPage() {
  const router = useRouter();
  const { parsedStory } = useGameStore();
  const [selected, setSelected] = useState<Character | null>(null);
  const [filter, setFilter] = useState('');
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>;
  }

  if (!parsedStory) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted mb-4">请先上传故事</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const characters = parsedStory.characters.filter(c =>
    !filter || c.name.includes(filter) || c.description.includes(filter)
  );

  const getRelationName = (charId: string) =>
    parsedStory.characters.find(c => c.id === charId)?.name || '未知';

  const showDetailMobile = !!selected;

  return (
    <div className="min-h-screen md:flex md:h-screen safe-top">
      {/* 列表（移动端：有选中时隐藏） */}
      <aside className={`${showDetailMobile ? 'hidden' : 'flex'} md:flex flex-col md:w-80 md:border-r md:border-border md:h-screen`}>
        <div className="glass border-b px-4 py-3">
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => router.back()} className="btn btn-ghost btn-sm" aria-label="返回">
              <ArrowLeft />
            </button>
            <h1 className="font-bold truncate" style={{ color: 'var(--accent)' }}>{parsedStory.title}</h1>
          </div>
          <p className="text-xs text-muted mb-3 font-sans">{characters.length} 个角色</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" width={16} height={16} />
            <input className="input" style={{ paddingLeft: '2.3rem' }}
                   value={filter} onChange={e => setFilter(e.target.value)} placeholder="搜索角色..." />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {characters.map(char => (
            <button key={char.id} onClick={() => setSelected(char)}
                    className={`w-full text-left p-3 rounded-lg mb-1 transition-colors flex items-center gap-3
                                ${selected?.id === char.id ? 'bg-accent/10' : 'hover:bg-surface-2'}`}>
              <div className="avatar avatar-md">{char.name[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{char.name}</div>
                <p className="text-xs text-muted truncate font-sans">{char.description}</p>
              </div>
            </button>
          ))}
          {characters.length === 0 && (
            <p className="text-center text-sm text-muted-dim py-8">未找到匹配的角色</p>
          )}
        </div>
      </aside>

      {/* 详情 */}
      <main className={`${showDetailMobile ? 'flex' : 'hidden md:flex'} flex-col flex-1 md:h-screen md:overflow-y-auto`}>
        {selected ? (
          <>
            {/* 移动端返回 */}
            <div className="md:hidden glass border-b px-4 py-3 flex items-center gap-2">
              <button onClick={() => setSelected(null)} className="btn btn-ghost btn-sm">
                <ArrowLeft /> 返回列表
              </button>
            </div>

            <div className="max-w-2xl w-full mx-auto p-5 sm:p-8">
              <div className="flex items-start gap-4 mb-8">
                <div className="avatar avatar-xl">{selected.name[0]}</div>
                <div className="min-w-0 flex-1 pt-1">
                  <h2 className="text-2xl sm:text-3xl font-bold">{selected.name}</h2>
                  {!selected.isOriginal && <span className="chip chip-teal mt-2">原创</span>}
                  <p className="text-foreground-soft mt-2 leading-relaxed">{selected.description}</p>
                </div>
              </div>

              <Section title="性格" body={selected.personality} />
              <Section title="背景" body={selected.background} />

              {selected.relationships.length > 0 && (
                <section className="mb-6">
                  <h3 className="label mb-3">关系网络</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selected.relationships.map((rel, idx) => (
                      <button key={idx}
                              onClick={() => {
                                const target = parsedStory.characters.find(c => c.id === rel.characterId);
                                if (target) setSelected(target);
                              }}
                              className="surface p-3 flex items-center gap-3 hover:border-accent/30 transition-colors text-left">
                        <div className="avatar avatar-sm">{getRelationName(rel.characterId)[0]}</div>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{getRelationName(rel.characterId)}</div>
                          <span className="text-xs text-muted font-sans">{rel.relation}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {(() => {
                const events = parsedStory.keyEvents.filter(e => e.involvedCharacterIds.includes(selected.id));
                if (!events.length) return null;
                return (
                  <section className="mb-6">
                    <h3 className="label mb-3">参与事件</h3>
                    <div className="space-y-2">
                      {events.map(event => (
                        <div key={event.id} className="surface p-3">
                          <div className="font-medium text-sm mb-1">{event.title}</div>
                          <p className="text-xs text-muted leading-relaxed">{event.description}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted p-6">
            <div className="text-center">
              <div className="avatar avatar-xl mx-auto mb-3" style={{ background: 'var(--surface-2)', color: 'var(--muted-dim)' }}>?</div>
              <p>选择一个角色查看详情</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="mb-6">
      <h3 className="label mb-2">{title}</h3>
      <div className="surface p-4 leading-relaxed text-foreground-soft">
        {body || <span className="text-muted-dim italic">暂无描述</span>}
      </div>
    </section>
  );
}
