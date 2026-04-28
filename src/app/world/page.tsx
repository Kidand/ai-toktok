'use client';

/**
 * /world — World Overview page.
 *
 * Reads `parsedStory` from the runtime store and surfaces the new tables
 * introduced in Phase 2 (entities / factions / lore / timeline) along
 * with the legacy character / location lists. Pure render — no LLM call.
 *
 * When a story was parsed under prompt v4 (before Phase 2), the new
 * tables are absent; we fall back to deriving them on the fly from the
 * legacy fields so the page always has something to show.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { getDisplayCharacters } from '@/lib/cast';
import { speakerColor } from '@/components/NarrativeFeed';
import { ArrowLeft, Users, Book } from '@/components/Icons';
import { RelationshipGraph } from '@/components/RelationshipGraph';
import type { Faction, LoreEntry, TimelineEvent } from '@/lib/types';

export default function WorldPage() {
  const router = useRouter();
  const { parsedStory, playerConfig, init, _hydrated } = useGameStore();

  useEffect(() => { init(); }, [init]);

  if (!_hydrated) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">加载中…</div>;
  }
  if (!parsedStory) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[var(--ink-muted)] mb-4 font-mono">尚未导入故事</p>
          <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
        </div>
      </div>
    );
  }

  const cast = getDisplayCharacters(parsedStory, playerConfig);
  const factions: Faction[] = parsedStory.factions || [];
  const loreEntries: LoreEntry[] = parsedStory.loreEntries
    || deriveFallbackLore(parsedStory.worldSetting.rules);
  const timeline: TimelineEvent[] = parsedStory.timelineEvents
    || parsedStory.keyEvents.map((e, i) => ({
      id: e.id, projectId: parsedStory.id,
      title: e.title, description: e.description,
      orderIndex: i, participants: [], causes: [], consequences: [],
    }));

  return (
    <div className="min-h-screen safe-top pb-12">
      <header className="sticky top-0 z-20 glass px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="label-mono">WORLD · 世界总览</span>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 space-y-10">
        {/* Hero */}
        <section>
          <div className="stamp mb-3" style={{ transform: 'rotate(-1.5deg)' }}>THE WORLD</div>
          <h1 className="display text-3xl sm:text-5xl mb-3 leading-[1.04]">{parsedStory.title}</h1>
          <p className="font-serif text-[var(--ink-soft)] leading-relaxed mb-3 text-lg">{parsedStory.summary}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip">{parsedStory.worldSetting.era}</span>
            <span className="chip">{parsedStory.worldSetting.genre}</span>
            <span className="chip">{cast.length} 角色</span>
            <span className="chip">{parsedStory.locations.length} 地点</span>
            {factions.length > 0 && <span className="chip chip-mint">{factions.length} 阵营</span>}
            {loreEntries.length > 0 && <span className="chip">{loreEntries.length} 设定</span>}
          </div>
        </section>

        {/* Cast */}
        <section>
          <SectionHead n="01" title="登场角色" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cast.map(c => (
              <div key={c.id} className="surface p-4 flex gap-3">
                <div className="avatar avatar-md" data-speaker-color={speakerColor(c.name)}>{c.name[0]}</div>
                <div className="min-w-0">
                  <div className="font-sans font-bold mb-0.5 truncate">{c.name}</div>
                  <p className="font-serif text-sm text-[var(--ink-soft)] line-clamp-2">{c.description}</p>
                  <p className="text-[11px] text-[var(--ink-muted)] mt-1.5 font-mono">{'// '}{c.personality}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Relationship graph */}
        <section>
          <SectionHead n="02" title="关系网" />
          <p className="font-mono text-xs text-[var(--ink-muted)] mb-3">
            {'// 节点 = 角色（首字母+稳定色）；线 = 关系；颜色映射倾向（亲近/中立/敌对），粗细 = 强度'}
          </p>
          <RelationshipGraph
            characters={cast}
            relationships={parsedStory.relationships}
          />
        </section>

        {/* Locations */}
        {parsedStory.locations.length > 0 && (
          <section>
            <SectionHead n="03" title="地点" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {parsedStory.locations.map(l => (
                <div key={l.id} className="surface p-4">
                  <div className="font-sans font-bold mb-1">{l.name}</div>
                  <p className="font-serif text-sm text-[var(--ink-soft)]">{l.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Factions */}
        {factions.length > 0 && (
          <section>
            <SectionHead n="04" title="阵营" />
            <div className="grid grid-cols-1 gap-3">
              {factions.map(f => (
                <div key={f.id} className="surface p-4">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h3 className="font-sans font-bold text-base">{f.name}</h3>
                    {f.ideology && <span className="chip chip-mint">{f.ideology}</span>}
                  </div>
                  {f.description && <p className="font-serif text-sm text-[var(--ink-soft)]">{f.description}</p>}
                  {f.rivals && f.rivals.length > 0 && (
                    <p className="text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
                      {'// 对手：'}{f.rivals.join('、')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <section>
            <SectionHead n="05" title="时间线" />
            <ol className="list-none space-y-3 pl-0">
              {timeline.map(e => (
                <li key={e.id} className="surface p-4">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-mono font-bold text-sm bg-[var(--ink)] text-[var(--paper)] px-2 py-0.5">
                      E{String(e.orderIndex + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-sans font-bold text-base">{e.title}</h3>
                  </div>
                  <p className="font-serif text-sm text-[var(--ink-soft)] leading-relaxed">{e.description}</p>
                  {e.causes && e.causes.length > 0 && (
                    <p className="text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
                      {'// 起因：'}{e.causes.join('；')}
                    </p>
                  )}
                  {e.consequences && e.consequences.length > 0 && (
                    <p className="text-[11px] text-[var(--ink-muted)] mt-1 font-mono">
                      {'// 后果：'}{e.consequences.join('；')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Lorebook */}
        {loreEntries.length > 0 && (
          <section>
            <SectionHead n="06" title="设定典籍" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {loreEntries.map(l => (
                <div key={l.id} className="surface p-4">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <h3 className="font-sans font-bold text-sm">{l.title}</h3>
                    <span className="chip">★ {l.importance ?? 3}</span>
                  </div>
                  <p className="font-serif text-sm text-[var(--ink-soft)]">{l.content}</p>
                  {l.triggerKeywords && l.triggerKeywords.length > 0 && (
                    <p className="text-[10px] text-[var(--ink-muted)] mt-2 font-mono">
                      {'// kw: '}{l.triggerKeywords.slice(0, 6).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <section className="pt-4 grid grid-cols-2 gap-2">
          <button onClick={() => router.push('/characters')} className="btn btn-outline">
            <Users width={16} height={16} /> 详细角色卡
          </button>
          <button onClick={() => router.push('/play')} className="btn btn-primary">
            <Book width={16} height={16} /> 进入故事
          </button>
        </section>
      </main>
    </div>
  );
}

function SectionHead({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3 flex-wrap">
      <span className="chapter-head"><span className="ordinal">Ch.{n}</span> · {title}</span>
    </div>
  );
}

function deriveFallbackLore(rules: string[]): LoreEntry[] {
  return rules.filter(r => r && r.trim()).map((r, i) => ({
    id: `fallback-lore-${i}`,
    projectId: '',
    title: r.length > 16 ? r.slice(0, 16) + '…' : r,
    content: r,
    importance: 4,
  }));
}
