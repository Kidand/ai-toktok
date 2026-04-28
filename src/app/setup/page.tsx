'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { EntryMode, Character } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import { generateReincarnationBrowser } from '@/lib/narrator-browser';
import { speakerColor } from '@/components/NarrativeFeed';
import { ArrowLeft, Users, Wand, Spinner, Refresh, Play } from '@/components/Icons';

export default function SetupPage() {
  const router = useRouter();
  const {
    parsedStory, llmConfig, setPlayerConfig, setGuardrailParams,
    setNarrativeBalance, startGame,
    guardrailParams, narrativeBalance, init,
  } = useGameStore();

  // Hard-refresh on /setup needs to drive its own IDB hydration —
  // the home page may never have run. Without this, parsedStory stays
  // null forever and we'd flash "请先上传故事" instead of recovering.
  useEffect(() => { init(); }, [init]);

  const [entryMode, setEntryMode] = useState<EntryMode>('soul-transfer');
  const [selectedCharId, setSelectedCharId] = useState('');
  const [entryEventIndex, setEntryEventIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reincarnation, setReincarnation] = useState<Character | null>(null);
  const [temperature, setTemperature] = useState(guardrailParams.temperature);
  const [strictness, setStrictness] = useState(guardrailParams.strictness);
  const [narrativeWeight, setNarrativeWeight] = useState(narrativeBalance.narrativeWeight);

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

  const handleGenerateReincarnation = async () => {
    if (!llmConfig || !parsedStory) return;
    setIsGenerating(true);
    try {
      const data = await generateReincarnationBrowser(llmConfig, parsedStory);
      // Map LLM-emitted target names back to canonical character ids so the
      // relationships are renderable by /characters and the relation graph.
      // The legacy embedding (`Character.relationships`) only carries the
      // label; polarity/strength are surfaced via the synthesized Phase 2
      // table that getReincarnationRelationships() derives at render time.
      const rawRels: Array<{ targetName?: string; relation?: string; polarity?: number; strength?: number }>
        = Array.isArray(data.relationships) ? data.relationships : [];
      const relationships = rawRels
        .map(r => {
          const target = parsedStory.characters.find(c =>
            c.name === r.targetName
            || (r.targetName && c.name.includes(r.targetName))
            || (r.targetName && r.targetName.includes(c.name))
          );
          if (!target || !r.relation) return null;
          return {
            characterId: target.id,
            relation: r.relation,
            polarity: typeof r.polarity === 'number' ? r.polarity : undefined,
            strength: typeof r.strength === 'number' ? r.strength : undefined,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      setReincarnation({
        id: uuid(),
        name: data.name,
        description: data.description,
        personality: data.personality,
        background: data.background,
        relationships,
        isOriginal: false,
      });
    } catch (err) {
      console.error('生成转生角色失败:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const canStart = (entryMode === 'soul-transfer' && selectedCharId)
                || (entryMode === 'reincarnation' && reincarnation);

  const handleStartGame = () => {
    if (!canStart) return;
    setGuardrailParams({ temperature, strictness });
    setNarrativeBalance({ narrativeWeight });
    setPlayerConfig({
      entryMode,
      characterId: entryMode === 'soul-transfer' ? selectedCharId : undefined,
      customCharacter: entryMode === 'reincarnation' ? reincarnation! : undefined,
      entryEventIndex,
    });
    startGame();
    router.push('/play');
  };

  return (
    <div className="min-h-screen safe-top pb-12">
      {/* Sticky top */}
      <div className="sticky top-0 z-20 glass px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="label-mono">SETUP · 故事设置</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 space-y-9">
        {/* 故事封面区 */}
        <section>
          <div className="stamp mb-3" style={{ transform: 'rotate(-1.5deg)' }}>THE BOOK</div>
          <h1 className="display text-3xl sm:text-5xl mb-4 leading-[1.04]">
            {parsedStory.title}
          </h1>
          <p className="font-serif text-[var(--ink-soft)] leading-relaxed mb-4 text-lg">{parsedStory.summary}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip">{parsedStory.worldSetting.era}</span>
            <span className="chip">{parsedStory.worldSetting.genre}</span>
            <button onClick={() => router.push('/characters')} className="chip chip-accent hover:-translate-y-px transition-transform" style={{ boxShadow: '1.5px 1.5px 0 var(--ink)' }}>
              <Users width={12} height={12} />
              {parsedStory.characters.length} 个角色
            </button>
            <span className="chip">{parsedStory.keyEvents.length} 个关键事件</span>
          </div>
        </section>

        {/* Ch.01 · 介入方式 */}
        <section>
          <SectionHead n="01" title="介入方式" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <EntryCard
              active={entryMode === 'soul-transfer'}
              onClick={() => setEntryMode('soul-transfer')}
              label="魂穿"
              tagline="你是故事里已有的某个人"
              description="扮演故事中的既有角色，以其身份体验故事"
            />
            <EntryCard
              active={entryMode === 'reincarnation'}
              onClick={() => setEntryMode('reincarnation')}
              label="转生"
              tagline="AI 给你一个全新身份"
              description="AI 按世界观生成全新原创角色，以新身份介入"
            />
          </div>
        </section>

        {/* Ch.02 · 角色选择 / 转生 */}
        <section>
          <SectionHead n="02" title={entryMode === 'soul-transfer' ? '选择角色' : '转生角色'} />

          {entryMode === 'soul-transfer' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 anim-fade-in">
              {parsedStory.characters.map((char, i) => (
                <button key={char.id} onClick={() => setSelectedCharId(char.id)}
                        className={`choice-card flex gap-3 items-start ${selectedCharId === char.id ? 'is-active' : ''}`}
                        style={{ transform: `rotate(${(i % 2 === 0 ? -0.25 : 0.25)}deg)` }}>
                  <div className="avatar avatar-md" data-speaker-color={speakerColor(char.name)}>{char.name[0]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-sans font-bold mb-0.5 truncate">{char.name}</div>
                    <p className="font-serif text-sm text-[var(--ink-soft)] line-clamp-2">{char.description}</p>
                    <p className="text-[11px] text-[var(--ink-muted)] mt-1.5 font-mono truncate">{'// '}{char.personality}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {entryMode === 'reincarnation' && (
            <div className="anim-fade-in">
              {reincarnation ? (
                <div className="surface-raised p-5">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="avatar avatar-lg" data-speaker-color="lilac">{reincarnation.name[0]}</div>
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="display text-2xl">{reincarnation.name}</h3>
                        <span className="chip chip-mint">原创</span>
                      </div>
                      <p className="font-serif text-[var(--ink-soft)] leading-relaxed">{reincarnation.description}</p>
                    </div>
                  </div>
                  <dl className="space-y-2 text-sm border-t-[2px] border-[var(--ink)] pt-3">
                    <div className="flex gap-3"><dt className="label-mono shrink-0">PERSONALITY</dt><dd className="font-serif flex-1">{reincarnation.personality}</dd></div>
                    <div className="flex gap-3"><dt className="label-mono shrink-0">BACKGROUND</dt><dd className="font-serif flex-1">{reincarnation.background}</dd></div>
                  </dl>
                  <button onClick={handleGenerateReincarnation} disabled={isGenerating} className="btn btn-outline btn-sm mt-4">
                    <Refresh width={14} height={14} />重新生成
                  </button>
                </div>
              ) : (
                <button onClick={handleGenerateReincarnation} disabled={isGenerating}
                        className="w-full choice-card p-8 text-center" style={{ borderStyle: 'dashed' }}>
                  {isGenerating ? (
                    <>
                      <Spinner className="mx-auto mb-3" style={{ color: 'var(--ink)' }} width={28} height={28} />
                      <p className="font-sans font-bold">正在生成角色...</p>
                      <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">AI 正在构思与世界观契合的新角色</p>
                    </>
                  ) : (
                    <>
                      <Wand className="mx-auto mb-3" style={{ color: 'var(--ink)' }} width={28} height={28} />
                      <p className="font-sans font-bold text-lg">点击生成转生角色</p>
                      <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">AI · 基于世界观 · 原创</p>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Ch.03 · 进入时间节点 */}
        <section>
          <SectionHead n="03" title="进入时间节点" />
          {parsedStory.timelineDescription && (
            <p className="font-mono text-xs text-[var(--ink-muted)] mb-3 leading-relaxed">
              {'// '}{parsedStory.timelineDescription}
            </p>
          )}
          <div className="space-y-2">
            {parsedStory.keyEvents.map((event, idx) => (
              <button key={event.id} onClick={() => setEntryEventIndex(idx)}
                      className={`choice-card flex items-start gap-3 ${entryEventIndex === idx ? 'is-active' : ''}`}>
                <span className="font-mono font-bold text-sm bg-[var(--ink)] text-[var(--paper)] px-2 py-1 shrink-0 rounded-[3px]">
                  E{String(idx + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="font-sans font-bold text-sm">{event.title}</div>
                  <p className="text-xs text-[var(--ink-muted)] mt-0.5 font-serif line-clamp-2">{event.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Ch.04 · 世界观护栏 */}
        <section>
          <SectionHead n="04" title="世界观护栏" />
          <div className="surface p-5 sm:p-6 space-y-6">
            <Slider label="随机性" variable="TEMPERATURE" value={temperature} min={0} max={1} step={0.1}
                    display={temperature.toFixed(1)}
                    leftHint="保守稳定" rightHint="创意发散"
                    onChange={setTemperature} />
            <Slider label="严谨度" variable="STRICTNESS" value={strictness} min={0} max={1} step={0.1}
                    display={strictness.toFixed(1)}
                    leftHint="自由松动" rightHint="严格原作"
                    onChange={setStrictness} />
            <Slider label="叙事比重" variable="NARRATIVE_WEIGHT" value={narrativeWeight} min={0} max={100} step={10}
                    display={`${narrativeWeight}%`}
                    leftHint="频繁对话" rightHint="沉浸叙事"
                    onChange={setNarrativeWeight} />
          </div>
        </section>

        {/* CTA inline */}
        <section className="pt-2">
          <button onClick={handleStartGame} disabled={!canStart}
                  className="btn btn-primary btn-lg btn-block">
            <Play width={18} height={18} />穿越开始 →
          </button>
          {!canStart && (
            <p className="text-xs text-[var(--ink-muted)] text-center mt-3 font-mono">
              {'// '}{entryMode === 'soul-transfer' ? '请先选择一个角色' : '请先生成转生角色'}
            </p>
          )}
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

function EntryCard({
  active, onClick, label, tagline, description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tagline: string;
  description: string;
}) {
  return (
    <button onClick={onClick} className={`choice-card ${active ? 'is-active' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="display text-2xl">{label}</span>
        {active && <span className="chip chip-accent">已选</span>}
      </div>
      <p className="font-mono text-[11px] text-[var(--ink-muted)] mb-2 uppercase tracking-wider">▸ {tagline}</p>
      <p className="font-serif text-sm text-[var(--ink-soft)] leading-relaxed">{description}</p>
    </button>
  );
}

function Slider({
  label, variable, value, min, max, step, display, leftHint, rightHint, onChange,
}: {
  label: string; variable: string;
  value: number; min: number; max: number; step: number;
  display: string; leftHint: string; rightHint: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2 gap-3">
        <div>
          <span className="font-sans font-bold text-sm">{label}</span>
          <span className="label-mono ml-2 text-[10px]">{variable}</span>
        </div>
        <span className="font-mono font-bold text-base tabular-nums bg-[var(--hi-yellow)] border-2 border-[var(--ink)] px-2 py-0.5" style={{ boxShadow: '1.5px 1.5px 0 var(--ink)' }}>
          {display}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={e => onChange(Number(e.target.value))}
             className="slider"
             style={{ ['--fill' as string]: `${fill}%` }} />
      <div className="flex justify-between text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
        <span>◂ {leftHint}</span>
        <span>{rightHint} ▸</span>
      </div>
    </div>
  );
}
