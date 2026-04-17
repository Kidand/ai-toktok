'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { EntryMode, Character } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import { generateReincarnationBrowser } from '@/lib/narrator-browser';
import { ArrowLeft, Users, Wand, Spinner, Refresh, Play } from '@/components/Icons';

export default function SetupPage() {
  const router = useRouter();
  const {
    parsedStory, llmConfig, setPlayerConfig, setGuardrailParams,
    setNarrativeBalance, startGame,
    guardrailParams, narrativeBalance,
  } = useGameStore();

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
          <p className="text-muted mb-4">请先上传故事</p>
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
      setReincarnation({
        id: uuid(),
        name: data.name,
        description: data.description,
        personality: data.personality,
        background: data.background,
        relationships: [],
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
    <div className="min-h-screen safe-top" style={{ paddingBottom: 'calc(10rem + env(safe-area-inset-bottom))' }}>
      {/* 顶栏 */}
      <div className="sticky top-0 z-20 glass border-b px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
          <ArrowLeft />
        </button>
        <span className="text-sm text-muted font-sans">故事设置</span>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* 故事信息 */}
        <section className="text-center">
          <h1 className="text-2xl sm:text-4xl font-bold mb-3"
              style={{
                background: 'linear-gradient(145deg, var(--accent-strong), var(--accent))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
            {parsedStory.title}
          </h1>
          <p className="text-foreground-soft leading-relaxed mb-4 max-w-xl mx-auto">{parsedStory.summary}</p>
          <div className="flex items-center justify-center gap-2 flex-wrap text-xs">
            <span className="chip">{parsedStory.worldSetting.era}</span>
            <span className="chip">{parsedStory.worldSetting.genre}</span>
            <button onClick={() => router.push('/characters')} className="chip chip-accent hover:opacity-80 transition-opacity">
              <Users width={12} height={12} />
              {parsedStory.characters.length} 个角色
            </button>
            <span className="chip">{parsedStory.keyEvents.length} 个关键事件</span>
          </div>
        </section>

        {/* 介入方式 */}
        <section>
          <h2 className="label mb-3 px-1">介入方式</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => setEntryMode('soul-transfer')}
                    className={`choice-card ${entryMode === 'soul-transfer' ? 'is-active' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold">魂穿</span>
                {entryMode === 'soul-transfer' && <span className="chip chip-accent" style={{ padding: '2px 8px' }}>已选</span>}
              </div>
              <p className="text-sm text-muted leading-relaxed">直接扮演故事中的某个角色，以其身份体验故事</p>
            </button>
            <button onClick={() => setEntryMode('reincarnation')}
                    className={`choice-card ${entryMode === 'reincarnation' ? 'is-active' : ''}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-bold">转生</span>
                {entryMode === 'reincarnation' && <span className="chip chip-accent" style={{ padding: '2px 8px' }}>已选</span>}
              </div>
              <p className="text-sm text-muted leading-relaxed">AI 生成全新角色，以新身份介入故事</p>
            </button>
          </div>
        </section>

        {/* 角色选择 / 转生生成 */}
        {entryMode === 'soul-transfer' && (
          <section className="anim-fade-in">
            <h2 className="label mb-3 px-1">选择角色</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {parsedStory.characters.map(char => (
                <button key={char.id} onClick={() => setSelectedCharId(char.id)}
                        className={`choice-card flex gap-3 items-start ${selectedCharId === char.id ? 'is-active' : ''}`}>
                  <div className="avatar avatar-md">{char.name[0]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold mb-1 truncate">{char.name}</div>
                    <p className="text-sm text-muted line-clamp-2">{char.description}</p>
                    <p className="text-xs text-muted-dim mt-1.5 italic line-clamp-1">{char.personality}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {entryMode === 'reincarnation' && (
          <section className="anim-fade-in">
            <h2 className="label mb-3 px-1">转生角色</h2>
            {reincarnation ? (
              <div className="surface p-5 anim-fade-in" style={{ borderColor: 'var(--accent)', background: 'linear-gradient(145deg, var(--accent-soft), transparent 70%), var(--surface-1)' }}>
                <div className="flex items-start gap-4 mb-4">
                  <div className="avatar avatar-lg">{reincarnation.name[0]}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold">{reincarnation.name}</h3>
                    <p className="text-sm text-foreground-soft leading-relaxed mt-1">{reincarnation.description}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div><span className="label mr-2">性格</span><span className="text-foreground-soft">{reincarnation.personality}</span></div>
                  <div><span className="label mr-2">背景</span><span className="text-foreground-soft">{reincarnation.background}</span></div>
                </div>
                <button onClick={handleGenerateReincarnation} disabled={isGenerating} className="btn btn-outline btn-sm mt-4">
                  <Refresh width={14} height={14} />重新生成
                </button>
              </div>
            ) : (
              <button onClick={handleGenerateReincarnation} disabled={isGenerating}
                      className="w-full surface p-8 text-center transition-colors hover:border-accent/50"
                      style={{ borderStyle: 'dashed' }}>
                {isGenerating ? (
                  <>
                    <Spinner className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                    <p className="font-medium">正在生成角色...</p>
                    <p className="text-xs text-muted-dim mt-1 font-sans">AI 正在构思一个与世界观契合的新角色</p>
                  </>
                ) : (
                  <>
                    <Wand className="mx-auto mb-2" style={{ color: 'var(--accent)' }} />
                    <p className="font-medium">点击生成转生角色</p>
                    <p className="text-xs text-muted-dim mt-1 font-sans">AI 将根据世界观创造一个合适的新角色</p>
                  </>
                )}
              </button>
            )}
          </section>
        )}

        {/* 时间节点 */}
        <section>
          <h2 className="label mb-3 px-1">进入时间节点</h2>
          {parsedStory.timelineDescription && (
            <p className="text-xs text-muted-dim mb-3 px-1 font-sans leading-relaxed">{parsedStory.timelineDescription}</p>
          )}
          <div className="space-y-2">
            {parsedStory.keyEvents.map((event, idx) => (
              <button key={event.id} onClick={() => setEntryEventIndex(idx)}
                      className={`choice-card flex items-start gap-3 ${entryEventIndex === idx ? 'is-active' : ''}`}>
                <span className="avatar avatar-sm shrink-0" style={{ fontSize: '0.75rem' }}>
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-sm">{event.title}</div>
                  <p className="text-xs text-muted mt-0.5 line-clamp-2">{event.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 护栏 */}
        <section className="surface p-5 sm:p-6">
          <h2 className="label mb-5">世界观护栏</h2>
          <div className="space-y-6">
            <Slider label="随机性" value={temperature} min={0} max={1} step={0.1}
                    display={temperature.toFixed(1)}
                    leftHint="保守稳定" rightHint="创意发散"
                    onChange={setTemperature} />
            <Slider label="严谨度" value={strictness} min={0} max={1} step={0.1}
                    display={strictness.toFixed(1)}
                    leftHint="自由松动" rightHint="严格原作"
                    onChange={setStrictness} />
            <Slider label="叙事比重" value={narrativeWeight} min={0} max={100} step={10}
                    display={`${narrativeWeight}%`}
                    leftHint="频繁对话" rightHint="沉浸叙事"
                    onChange={setNarrativeWeight} />
          </div>
        </section>
      </main>

      {/* 吸底 CTA */}
      <div className="fixed bottom-0 inset-x-0 z-30 glass border-t px-4 sm:px-6 py-3 pb-safe">
        <div className="max-w-3xl mx-auto">
          <button onClick={handleStartGame} disabled={!canStart}
                  className="btn btn-primary btn-lg btn-block">
            <Play width={16} height={16} />穿越开始
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, leftHint, rightHint, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; leftHint: string; rightHint: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between items-center mb-2 font-sans">
        <span className="text-sm text-foreground-soft">{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={e => onChange(Number(e.target.value))}
             className="slider"
             style={{ ['--fill' as string]: `${fill}%` }} />
      <div className="flex justify-between text-xs text-muted-dim mt-1.5 font-sans">
        <span>{leftHint}</span>
        <span>{rightHint}</span>
      </div>
    </div>
  );
}
