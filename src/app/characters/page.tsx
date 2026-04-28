'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { Character } from '@/lib/types';
import { getDisplayCharacters } from '@/lib/cast';
import { speakerColor } from '@/components/NarrativeFeed';
import { ArrowLeft, Search } from '@/components/Icons';

export default function CharactersPage() {
  const router = useRouter();
  const { parsedStory, playerConfig, init } = useGameStore();
  const [selected, setSelected] = useState<Character | null>(null);
  const [filter, setFilter] = useState('');
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  // Hard-refresh on /characters needs its own IDB hydration; otherwise
  // parsedStory stays null forever and we'd show "请先上传故事".
  useEffect(() => { init(); }, [init]);

  // Hooks must run on every render — keep them above any early-return.
  // `getDisplayCharacters` defends against null parsedStory itself.
  const allCharacters = useMemo(
    () => parsedStory ? getDisplayCharacters(parsedStory, playerConfig) : [],
    [parsedStory, playerConfig],
  );

  if (!mounted) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)] font-mono">加载中...</div>;
  }

  if (!parsedStory) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[var(--ink-muted)] mb-4 font-mono">请先上传故事</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const characters = allCharacters.filter(c =>
    !filter || c.name.includes(filter) || c.description.includes(filter)
  );

  const getRelationName = (charId: string) =>
    allCharacters.find(c => c.id === charId)?.name || '未知';

  const showDetailMobile = !!selected;

  return (
    <div className="min-h-screen md:flex md:h-screen safe-top">
      {/* 列表（移动端：选中时隐藏） */}
      <aside className={`${showDetailMobile ? 'hidden' : 'flex'} md:flex flex-col md:w-[320px] md:h-screen bg-[var(--paper-raised)]`}
             style={{ borderRight: '2.5px solid var(--ink)' }}>
        <div className="glass px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => router.back()} className="btn btn-ghost btn-sm" aria-label="返回">
              <ArrowLeft />
            </button>
            <span className="label-mono text-[10px]">CAST ·</span>
            <h1 className="font-sans font-bold truncate">{parsedStory.title}</h1>
          </div>
          <p className="text-xs text-[var(--ink-muted)] mb-3 font-mono">{'// '}{characters.length} characters</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" width={15} height={15} />
            <input className="input input-mono" style={{ paddingLeft: '2.3rem' }}
                   value={filter} onChange={e => setFilter(e.target.value)} placeholder="search..." />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {characters.map((char, i) => (
            <button key={char.id} onClick={() => setSelected(char)}
                    className={`w-full text-left p-3 border-[2.5px] flex items-center gap-3 transition-all
                                ${selected?.id === char.id
                                  ? 'bg-[var(--hi-yellow)] border-[var(--ink)]'
                                  : 'bg-[var(--paper-raised)] border-[var(--ink)] hover:-translate-y-px'}`}
                    style={{
                      boxShadow: selected?.id === char.id ? '4px 4px 0 var(--ink)' : '2px 2px 0 var(--ink)',
                      borderRadius: 'var(--radius-sm)',
                      transform: `${selected?.id === char.id ? '' : `rotate(${i % 3 === 0 ? -0.3 : i % 3 === 1 ? 0.25 : 0}deg)`}`,
                    }}>
              <div className="avatar avatar-md" data-speaker-color={speakerColor(char.name)}>{char.name[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="font-sans font-bold text-sm truncate">{char.name}</div>
                <p className="text-xs text-[var(--ink-muted)] truncate font-serif">{char.description}</p>
              </div>
            </button>
          ))}
          {characters.length === 0 && (
            <p className="text-center text-sm text-[var(--ink-muted)] py-8 font-mono">{'// 未找到匹配'}</p>
          )}
        </div>
      </aside>

      {/* 详情 */}
      <main className={`${showDetailMobile ? 'flex' : 'hidden md:flex'} flex-col flex-1 md:h-screen md:overflow-y-auto bg-[var(--paper)]`}>
        {selected ? (
          <>
            <div className="md:hidden glass px-4 py-3 flex items-center gap-2">
              <button onClick={() => setSelected(null)} className="btn btn-ghost btn-sm">
                <ArrowLeft /> 返回列表
              </button>
            </div>

            <div className="max-w-2xl w-full mx-auto p-5 sm:p-8">
              {/* Character dossier header */}
              <div className="surface-hero p-6 mb-6">
                <div className="flex items-start gap-4 mb-4">
                  <div className="avatar avatar-xl" data-speaker-color={speakerColor(selected.name)}>
                    {selected.name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="label-mono">DOSSIER</span>
                      {!selected.isOriginal && <span className="chip chip-mint">原创</span>}
                    </div>
                    <h2 className="display text-3xl sm:text-4xl mb-2">{selected.name}</h2>
                    <p className="font-serif text-[var(--ink-soft)] leading-relaxed">{selected.description}</p>
                  </div>
                </div>
              </div>

              <Section title="性格" mono="PERSONALITY" body={selected.personality} />
              <Section title="背景" mono="BACKGROUND" body={selected.background} />

              {selected.relationships.length > 0 && (
                <section className="mb-6">
                  <SectionHead mono="RELATIONS" title="关系网络" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selected.relationships.map((rel, idx) => {
                      const tName = getRelationName(rel.characterId);
                      return (
                        <button key={idx}
                                onClick={() => {
                                  const target = allCharacters.find(c => c.id === rel.characterId);
                                  if (target) setSelected(target);
                                }}
                                className="choice-card flex items-center gap-3 text-left">
                          <div className="avatar avatar-sm" data-speaker-color={speakerColor(tName)}>{tName[0]}</div>
                          <div className="min-w-0">
                            <div className="font-sans font-bold text-sm truncate">{tName}</div>
                            <span className="text-xs text-[var(--ink-muted)] font-mono">▸ {rel.relation}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {(() => {
                const events = parsedStory.keyEvents.filter(e => e.involvedCharacterIds.includes(selected.id));
                if (!events.length) return null;
                return (
                  <section className="mb-6">
                    <SectionHead mono="KEY EVENTS" title="参与事件" />
                    <div className="space-y-2">
                      {events.map((event, i) => (
                        <div key={event.id} className="surface p-3 flex gap-3">
                          <span className="font-mono font-bold text-xs bg-[var(--ink)] text-[var(--paper)] px-2 py-1 shrink-0 rounded-[3px] self-start">
                            E{String(i + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <div className="font-sans font-bold text-sm mb-1">{event.title}</div>
                            <p className="text-xs text-[var(--ink-muted)] font-serif leading-relaxed">{event.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <div className="avatar avatar-xl mx-auto mb-4" style={{ background: 'var(--paper-sunken)', color: 'var(--ink-muted)' }}>?</div>
              <p className="font-sans text-[var(--ink-muted)]">从左侧选择一个角色</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function SectionHead({ mono, title }: { mono: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-2">
      <span className="label-mono">{mono}</span>
      <h3 className="font-sans font-bold text-base">{title}</h3>
    </div>
  );
}

function Section({ title, mono, body }: { title: string; mono: string; body: string }) {
  return (
    <section className="mb-6">
      <SectionHead mono={mono} title={title} />
      <div className="surface p-4 font-serif leading-relaxed text-[var(--ink-soft)]">
        {body || <span className="text-[var(--ink-faint)] italic">（暂无描述）</span>}
      </div>
    </section>
  );
}
