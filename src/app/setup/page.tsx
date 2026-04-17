'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { EntryMode, Character } from '@/lib/types';
import { v4 as uuid } from 'uuid';
import { generateReincarnationBrowser } from '@/lib/narrator-browser';

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">请先上传故事</p>
          <button onClick={() => router.push('/')} className="text-accent hover:underline">
            返回首页
          </button>
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

  const handleStartGame = () => {
    setGuardrailParams({ temperature, strictness });
    setNarrativeBalance({ narrativeWeight });

    if (entryMode === 'soul-transfer' && !selectedCharId) return;
    if (entryMode === 'reincarnation' && !reincarnation) return;

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
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* 返回按钮 */}
      <button onClick={() => router.push('/')} className="text-muted text-sm hover:text-foreground mb-6 block">
        &larr; 返回
      </button>

      {/* 故事信息 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--accent)' }}>
          {parsedStory.title}
        </h1>
        <p className="text-muted leading-relaxed">{parsedStory.summary}</p>
        <div className="flex gap-4 mt-3 text-sm text-muted">
          <span>{parsedStory.worldSetting.era}</span>
          <span>·</span>
          <span>{parsedStory.worldSetting.genre}</span>
          <span>·</span>
          <button onClick={() => router.push('/characters')} className="text-accent hover:underline">
            {parsedStory.characters.length} 个角色 &rarr;
          </button>
          <span>·</span>
          <span>{parsedStory.keyEvents.length} 个关键事件</span>
        </div>
      </div>

      {/* 介入方式选择 */}
      <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">介入方式</h2>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setEntryMode('soul-transfer')}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              entryMode === 'soul-transfer'
                ? 'border-accent bg-accent/5'
                : 'border-card-border hover:border-accent/30'
            }`}
          >
            <div className="text-lg font-bold mb-1">魂穿</div>
            <p className="text-sm text-muted">直接扮演故事中的某个角色，以其身份体验故事</p>
          </button>
          <button
            onClick={() => setEntryMode('reincarnation')}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              entryMode === 'reincarnation'
                ? 'border-accent bg-accent/5'
                : 'border-card-border hover:border-accent/30'
            }`}
          >
            <div className="text-lg font-bold mb-1">转生</div>
            <p className="text-sm text-muted">AI根据世界观生成全新角色，以新身份介入故事</p>
          </button>
        </div>
      </div>

      {/* 角色选择 */}
      {entryMode === 'soul-transfer' && (
        <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">选择角色</h2>
          <div className="grid grid-cols-2 gap-3">
            {parsedStory.characters.map(char => (
              <button
                key={char.id}
                onClick={() => setSelectedCharId(char.id)}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  selectedCharId === char.id
                    ? 'border-accent bg-accent/5'
                    : 'border-card-border hover:border-accent/30'
                }`}
              >
                <div className="font-bold mb-1">{char.name}</div>
                <p className="text-sm text-muted line-clamp-2">{char.description}</p>
                <p className="text-xs text-muted mt-2 italic">{char.personality}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 转生角色生成 */}
      {entryMode === 'reincarnation' && (
        <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">转生角色</h2>
          {reincarnation ? (
            <div className="p-4 rounded-xl border border-accent/30 bg-accent/5">
              <div className="font-bold text-lg mb-1">{reincarnation.name}</div>
              <p className="text-sm text-muted mb-2">{reincarnation.description}</p>
              <p className="text-sm"><strong>性格：</strong>{reincarnation.personality}</p>
              <p className="text-sm mt-1"><strong>背景：</strong>{reincarnation.background}</p>
              <button
                onClick={handleGenerateReincarnation}
                className="mt-3 text-sm text-accent hover:underline"
              >
                重新生成
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerateReincarnation}
              disabled={isGenerating}
              className="w-full py-4 rounded-xl border-2 border-dashed border-card-border hover:border-accent/50 transition-colors text-muted disabled:opacity-50"
            >
              {isGenerating ? '正在生成角色...' : '点击生成转生角色'}
            </button>
          )}
        </div>
      )}

      {/* 时间节点选择 */}
      <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">进入时间节点</h2>
        <p className="text-xs text-muted mb-3">{parsedStory.timelineDescription}</p>
        <div className="space-y-2">
          {parsedStory.keyEvents.map((event, idx) => (
            <button
              key={event.id}
              onClick={() => setEntryEventIndex(idx)}
              className={`w-full p-3 rounded-lg border text-left transition-all ${
                entryEventIndex === idx
                  ? 'border-accent bg-accent/5'
                  : 'border-card-border hover:border-accent/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    background: entryEventIndex === idx ? 'var(--accent)' : 'var(--card-border)',
                    color: entryEventIndex === idx ? 'black' : 'var(--muted)',
                  }}
                >
                  {idx + 1}
                </span>
                <div>
                  <div className="font-medium text-sm">{event.title}</div>
                  <p className="text-xs text-muted mt-0.5 line-clamp-1">{event.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 双变量控制 */}
      <div className="bg-card-bg border border-card-border rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">世界观护栏</h2>
        <div className="space-y-5">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>随机性 (Temperature)</span>
              <span className="text-accent">{temperature.toFixed(1)}</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.1"
              value={temperature}
              onChange={e => setTemperature(Number(e.target.value))}
              className="w-full accent-amber-600"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>保守稳定</span>
              <span>创意发散</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>严谨度 (Strictness)</span>
              <span className="text-accent">{strictness.toFixed(1)}</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.1"
              value={strictness}
              onChange={e => setStrictness(Number(e.target.value))}
              className="w-full accent-amber-600"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>自由松动</span>
              <span>严格原作</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>叙事/对话比重</span>
              <span className="text-accent">{narrativeWeight}%</span>
            </div>
            <input
              type="range" min="0" max="100" step="10"
              value={narrativeWeight}
              onChange={e => setNarrativeWeight(Number(e.target.value))}
              className="w-full accent-amber-600"
            />
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>频繁对话</span>
              <span>沉浸叙事</span>
            </div>
          </div>
        </div>
      </div>

      {/* 开始按钮 */}
      <button
        onClick={handleStartGame}
        disabled={
          (entryMode === 'soul-transfer' && !selectedCharId) ||
          (entryMode === 'reincarnation' && !reincarnation)
        }
        className="w-full py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'var(--accent)', color: 'black' }}
      >
        穿越开始
      </button>
    </div>
  );
}
