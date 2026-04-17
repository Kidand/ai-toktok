'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { streamNarrationBrowser, parseNarrationResponse, generateEpilogueBrowser, systemHintBrowser, type StreamingState } from '@/lib/narrator-browser';
import { NarrativeFeed } from '@/components/NarrativeFeed';
import { MentionInput, MentionInputHandle, MentionCandidate, MentionParsed } from '@/components/MentionInput';
import { ArrowLeft, Users, Send, Close, CheckCircle, Sparkles } from '@/components/Icons';

const SYSTEM_MENTION_ID = 'system';
const PRESENCE_WINDOW = 5;

export default function PlayPage() {
  const router = useRouter();
  const {
    parsedStory, playerConfig, llmConfig, isPlaying,
    narrativeHistory, guardrailParams, narrativeBalance,
    addNarrativeEntries, addPlayerAction, addCharacterInteractions,
    autoSave, completeGame, setIsGenerating, isGenerating,
    characterInteractions,
  } = useGameStore();

  const [showSidebar, setShowSidebar] = useState(false);
  const [streamingState, setStreamingState] = useState<StreamingState>({ narration: '', dialogues: [] });
  const [endConfirm, setEndConfirm] = useState(false);
  const [systemHint, setSystemHint] = useState<{ question: string; answer: string; loading: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<MentionInputHandle>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [narrativeHistory, streamingState, systemHint]);

  const playerChar = useMemo(() => {
    if (!parsedStory || !playerConfig) return undefined;
    return playerConfig.entryMode === 'soul-transfer'
      ? parsedStory.characters.find(c => c.id === playerConfig.characterId)
      : playerConfig.customCharacter;
  }, [parsedStory, playerConfig]);

  /** Characters that have appeared in the last PRESENCE_WINDOW entries. */
  const presentNames = useMemo(() => {
    if (!parsedStory) return new Set<string>();
    const recent = narrativeHistory.slice(-PRESENCE_WINDOW);
    const present = new Set<string>();
    for (const entry of recent) {
      if (entry.type === 'dialogue' && entry.speaker) present.add(entry.speaker);
      const content = entry.content || '';
      for (const c of parsedStory.characters) {
        if (c.name && content.includes(c.name)) present.add(c.name);
      }
    }
    return present;
  }, [narrativeHistory, parsedStory]);

  /** Mention candidates: System → interactable → non-interactable. Excludes player char. */
  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    if (!parsedStory) return [];
    const system: MentionCandidate = {
      id: SYSTEM_MENTION_ID, name: '系统', kind: 'system', interactable: true,
      hint: '咨询提示 · 不计入对话',
    };
    const interactable: MentionCandidate[] = [];
    const inactive: MentionCandidate[] = [];
    for (const c of parsedStory.characters) {
      if (playerChar && c.id === playerChar.id) continue;
      const cand: MentionCandidate = {
        id: c.id, name: c.name, kind: 'character',
        interactable: presentNames.has(c.name),
        hint: c.personality?.slice(0, 30) || c.description?.slice(0, 30),
      };
      (cand.interactable ? interactable : inactive).push(cand);
    }
    return [system, ...interactable, ...inactive];
  }, [parsedStory, playerChar, presentNames]);

  const streamNarrate = useCallback(async (
    action: string,
    playerInput?: string,
    mentionedNames?: string[],
    fromChoice?: boolean,
  ) => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    setIsGenerating(true);
    setStreamingState({ narration: '', dialogues: [] });
    const input = action === 'opening' ? '（我刚刚来到这个世界，环顾四周）' : (playerInput || '');
    try {
      const raw = await streamNarrationBrowser(
        llmConfig, parsedStory, playerConfig,
        guardrailParams, narrativeBalance,
        narrativeHistory, input,
        (state) => setStreamingState(state),
        mentionedNames,
        fromChoice,
      );
      setStreamingState({ narration: '', dialogues: [] });
      const result = parseNarrationResponse(raw, parsedStory, input);
      addNarrativeEntries(result.entries);
      if (result.interactions?.length) {
        addCharacterInteractions(result.interactions as Parameters<typeof addCharacterInteractions>[0]);
      }
      autoSave();
    } catch (err) {
      console.error('叙事生成失败:', err);
    } finally {
      setIsGenerating(false);
      setStreamingState({ narration: '', dialogues: [] });
    }
  }, [llmConfig, parsedStory, playerConfig, guardrailParams, narrativeBalance, narrativeHistory, addNarrativeEntries, addCharacterInteractions, autoSave, setIsGenerating]);

  const generateOpening = useCallback(async () => {
    if (!llmConfig || !parsedStory || !playerConfig || narrativeHistory.length > 0) return;
    await streamNarrate('opening');
  }, [llmConfig, parsedStory, playerConfig, narrativeHistory.length, streamNarrate]);

  useEffect(() => {
    if (isPlaying && narrativeHistory.length === 0 && !isGenerating) {
      generateOpening();
    }
  }, [isPlaying, narrativeHistory.length, isGenerating, generateOpening]);

  if (!parsedStory || !playerConfig || !isPlaying) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted mb-4">请先完成故事设置</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => router.push('/setup')} className="btn btn-primary">返回设置</button>
            <button onClick={() => router.push('/')} className="btn btn-outline">返回首页</button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (parsed: MentionParsed) => {
    const text = parsed.plainText.trim();
    if (!text || isGenerating || !llmConfig) return;

    const hasSystem = parsed.mentions.some(m => m.kind === 'system');
    // De-dup character mentions in case same character was @'d twice
    const characterMentions = Array.from(new Set(
      parsed.mentions.filter(m => m.kind === 'character').map(m => m.name),
    ));

    inputRef.current?.clear();

    if (hasSystem) {
      // Consult system — ephemeral, does not advance story
      // Strip the @系统 mention from the question to keep it clean
      const question = text.replace(/@系统\s*/g, '').trim() || '请给我一些提示';
      setSystemHint({ question, answer: '', loading: true });
      try {
        const answer = await systemHintBrowser(
          llmConfig, parsedStory, playerConfig, narrativeHistory, question,
        );
        setSystemHint({ question, answer, loading: false });
      } catch (err) {
        console.error('系统提示生成失败:', err);
        setSystemHint({ question, answer: '系统暂时无法回应，请稍后再试。', loading: false });
      }
      return;
    }

    addPlayerAction(text);
    await streamNarrate('narrate', text, characterMentions.length > 0 ? characterMentions : undefined);
  };

  const handleChoice = (choiceText: string) => {
    if (isGenerating || !llmConfig) return;
    addPlayerAction(choiceText);
    streamNarrate('narrate', choiceText, undefined, true);
  };

  const handleEndStory = async () => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    setEndConfirm(false);
    setIsGenerating(true);
    try {
      const epilogue = await generateEpilogueBrowser(llmConfig, parsedStory, playerConfig, characterInteractions, narrativeHistory);
      completeGame(epilogue);
      router.push('/epilogue');
    } catch (err) {
      console.error('生成后日谈失败:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const lastChoices = [...narrativeHistory].reverse().find(e => e.choices?.length)?.choices;
  const canEnd = narrativeHistory.length >= 4;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶栏 */}
      <header className="glass border-b px-3 sm:px-5 py-3 flex items-center justify-between shrink-0 safe-top">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
            <ArrowLeft />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate" style={{ color: 'var(--accent)' }}>{parsedStory.title}</h1>
            <p className="text-xs text-muted font-sans truncate">
              {playerChar?.name || '旅人'} · {playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setShowSidebar(true)} className="btn btn-ghost btn-sm" aria-label="角色">
            <Users />
          </button>
          <button onClick={() => setEndConfirm(true)} disabled={isGenerating || !canEnd}
                  className="btn btn-outline btn-sm">
            <span className="hidden sm:inline">结束故事</span>
            <span className="sm:hidden">结束</span>
          </button>
        </div>
      </header>

      {/* 主叙事区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          {!canEnd && (
            <p className="text-xs text-muted-dim text-center mb-6 font-sans">
              故事刚刚开始 · 与世界互动至少 4 次后可结束
            </p>
          )}
          <NarrativeFeed
            entries={narrativeHistory}
            playerName={playerChar?.name}
            streamingNarration={streamingState.narration}
            streamingDialogues={streamingState.dialogues}
            isGenerating={isGenerating}
          />
        </div>
      </div>

      {/* 选项区 */}
      {lastChoices && lastChoices.length > 0 && !isGenerating && (
        <div className="shrink-0 px-4 sm:px-6 pb-2 anim-fade-in">
          <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
            {lastChoices.map(choice => (
              <button key={choice.id} onClick={() => handleChoice(choice.text)}
                      className={`chip hover:border-accent transition-colors cursor-pointer ${choice.isBranchPoint ? 'chip-accent branch-marker' : ''}`}
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                {choice.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 系统提示浮层 */}
      {systemHint && (
        <div className="shrink-0 px-4 sm:px-6 pb-3 anim-fade-in">
          <div className="max-w-3xl mx-auto">
            <div className="system-hint">
              <button className="system-hint-close" onClick={() => setSystemHint(null)} aria-label="关闭">
                <Close width={14} height={14} />
              </button>
              <div className="system-hint-header">
                <Sparkles width={12} height={12} /> 系统提示 · 不计入对话
              </div>
              <div className="system-hint-body">
                {systemHint.loading ? (
                  <span className="text-muted italic typing-cursor">正在查询</span>
                ) : systemHint.answer}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="glass border-t shrink-0 px-3 sm:px-5 py-3 pb-safe">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <MentionInput
            ref={inputRef}
            candidates={mentionCandidates}
            placeholder={isGenerating ? '角色正在响应...' : '你想做什么... (输入 @ 与角色互动 / 咨询系统)'}
            disabled={isGenerating}
            onSubmit={handleSubmit}
          />
          <button
            onClick={() => {
              const parsed = inputRef.current?.getParsed();
              if (parsed) handleSubmit(parsed);
            }}
            disabled={isGenerating}
            className="btn btn-primary shrink-0" aria-label="发送">
            <Send width={18} height={18} />
            <span className="hidden sm:inline">行动</span>
          </button>
        </div>
      </div>

      {/* 角色侧栏 / 底部抽屉 */}
      {showSidebar && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 anim-fade-in" onClick={() => setShowSidebar(false)} />
          <aside className="fixed z-50 anim-slide-up surface-raised overflow-hidden flex flex-col
                            right-0 top-0 bottom-0 w-full sm:w-80 sm:border-l
                            rounded-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-bold">角色</h2>
              <button onClick={() => setShowSidebar(false)} className="btn btn-ghost btn-sm" aria-label="关闭">
                <Close />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {parsedStory.characters.map(char => {
                const interaction = characterInteractions.find(ci => ci.characterId === char.id);
                const isPlayer = char.id === playerConfig.characterId;
                const isPresent = presentNames.has(char.name);
                return (
                  <div key={char.id} className="surface p-3 flex gap-3">
                    <div className="relative">
                      <div className="avatar avatar-sm">{char.name[0]}</div>
                      {!isPlayer && (
                        <span className={`mention-status-dot ${isPresent ? 'is-on' : ''}`}
                              style={{ position: 'absolute', bottom: -1, right: -1, border: '2px solid var(--surface-1)', width: 10, height: 10 }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <span className="truncate">{char.name}</span>
                        {isPlayer && <span className="chip chip-accent" style={{ padding: '1px 6px', fontSize: '0.65rem' }}>你</span>}
                      </div>
                      <p className="text-xs text-muted mt-1 line-clamp-2">{char.personality}</p>
                      {interaction && interaction.interactions.length > 0 && (
                        <p className="text-xs mt-1.5 font-sans" style={{ color: 'var(--teal)' }}>
                          {interaction.interactions.length} 次互动
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}

      {/* 结束确认 */}
      {endConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 anim-fade-in"
             onClick={() => setEndConfirm(false)}>
          <div className="surface-raised max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <CheckCircle className="mx-auto mb-3" style={{ color: 'var(--accent)' }} width={32} height={32} />
            <h3 className="text-lg font-bold text-center mb-2">确认结束故事？</h3>
            <p className="text-sm text-muted text-center mb-5 font-sans">
              AI 将根据你与各角色的互动生成后日谈，<br />结束后故事不可再继续。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setEndConfirm(false)} className="btn btn-outline">取消</button>
              <button onClick={handleEndStory} className="btn btn-primary">生成后日谈</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
