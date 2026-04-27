'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { streamNarrationBrowser, parseNarrationResponse, systemHintBrowser, type StreamingState } from '@/lib/narrator-browser';
import { generateSceneReflection, type SceneReflection } from '@/lib/reflection_reporter';
import { agentInterview } from '@/lib/reflection_reporter/deep-interaction';
import { agentProfileFromCharacter } from '@/lib/agent_factory';
import { NarrativeFeed, speakerColor } from '@/components/NarrativeFeed';
import { MentionInput, MentionInputHandle, MentionCandidate, MentionParsed } from '@/components/MentionInput';
import { ArrowLeft, Users, Send, Close, Sparkles, Globe } from '@/components/Icons';

const SYSTEM_MENTION_ID = 'system';
const PRESENCE_WINDOW = 5;

export default function PlayPage() {
  const router = useRouter();
  const {
    parsedStory, playerConfig, llmConfig, isPlaying,
    narrativeHistory, guardrailParams, narrativeBalance, injectionConfig,
    addNarrativeEntries, addPlayerAction, addCharacterInteractions,
    autoSave, setIsGenerating, isGenerating,
    characterInteractions,
    init, _hydrated, currentSaveId,
  } = useGameStore();

  // Hard refresh / direct navigation to /play needs to drive the IDB hydration
  // itself; the home page may never have run.
  useEffect(() => { init(); }, [init]);

  const [showSidebar, setShowSidebar] = useState(false);
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);
  const [streamingState, setStreamingState] = useState<StreamingState>({ narration: '', dialogues: [] });
  const [endConfirm, setEndConfirm] = useState(false);
  const [systemHint, setSystemHint] = useState<{ question: string; answer: string; loading: boolean } | null>(null);
  const [reflection, setReflection] = useState<{ loading: boolean; data: SceneReflection | null; error?: string } | null>(null);
  const [interview, setInterview] = useState<{ characterId: string; characterName: string; question: string; answer: string; loading: boolean } | null>(null);
  const [interviewDraft, setInterviewDraft] = useState('');
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
        injectionConfig,
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
  }, [llmConfig, parsedStory, playerConfig, guardrailParams, narrativeBalance, narrativeHistory, injectionConfig, addNarrativeEntries, addCharacterInteractions, autoSave, setIsGenerating]);

  const generateOpening = useCallback(async () => {
    if (!llmConfig || !parsedStory || !playerConfig || narrativeHistory.length > 0) return;
    await streamNarrate('opening');
  }, [llmConfig, parsedStory, playerConfig, narrativeHistory.length, streamNarrate]);

  useEffect(() => {
    if (isPlaying && narrativeHistory.length === 0 && !isGenerating) {
      generateOpening();
    }
  }, [isPlaying, narrativeHistory.length, isGenerating, generateOpening]);

  // While IndexedDB is rehydrating an in-progress game, show a loader rather
  // than the "请先完成设置" fallback — the data is on the way.
  if (!_hydrated && currentSaveId) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">加载游戏中...</div>;
  }

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

  const handleReflection = async () => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    setReflection({ loading: true, data: null });
    try {
      const data = await generateSceneReflection({
        config: llmConfig,
        story: parsedStory,
        playerConfig,
        history: narrativeHistory,
      });
      setReflection({ loading: false, data });
    } catch (err) {
      setReflection({ loading: false, data: null, error: err instanceof Error ? err.message : '生成失败' });
    }
  };

  const handleInterview = async (characterId: string, question: string) => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    const character = parsedStory.characters.find(c => c.id === characterId);
    if (!character) return;
    const trimmed = question.trim();
    if (!trimmed) return;
    setInterview({ characterId, characterName: character.name, question: trimmed, answer: '', loading: true });
    try {
      const projectId = parsedStory.project?.id || parsedStory.id;
      const profile = parsedStory.agents?.find(a => a.entityId === character.id)
        || agentProfileFromCharacter(projectId, character, parsedStory);
      const answer = await agentInterview({
        config: llmConfig,
        story: parsedStory,
        playerConfig,
        history: narrativeHistory,
        agent: profile,
        question: trimmed,
      });
      setInterview({ characterId, characterName: character.name, question: trimmed, answer, loading: false });
    } catch (err) {
      setInterview({
        characterId, characterName: character.name, question: trimmed,
        answer: err instanceof Error ? err.message : '访谈失败',
        loading: false,
      });
    }
  };

  const handleEndStory = () => {
    if (!llmConfig || !parsedStory || !playerConfig) return;
    setEndConfirm(false);
    // Navigate to the epilogue page immediately; it will run generation
    // itself and stream results with a progress bar, so the user doesn't
    // sit on the play screen watching a disabled button.
    router.push('/epilogue?generating=1');
  };

  const lastChoices = [...narrativeHistory].reverse().find(e => e.choices?.length)?.choices;
  const canEnd = narrativeHistory.length >= 4;

  return (
    <div className="h-screen flex flex-col bg-[var(--paper)]">
      {/* 顶栏 */}
      <header className="glass px-3 sm:px-5 py-3 flex items-center justify-between shrink-0 safe-top">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onClick={() => router.push('/')} className="btn btn-ghost btn-sm" aria-label="返回">
            <ArrowLeft />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="label-mono text-[10px]">PLAY ·</span>
              <h1 className="font-sans font-bold text-sm truncate">{parsedStory.title}</h1>
            </div>
            <p className="text-xs text-[var(--ink-muted)] font-mono truncate mt-0.5">
              {playerChar?.name || '旅人'} · {playerConfig.entryMode === 'soul-transfer' ? 'soul-transfer' : 'reincarnation'} · T{String(narrativeHistory.filter(e => e.type === 'player-action').length).padStart(2, '0')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => router.push('/world')} className="btn btn-ghost btn-sm" aria-label="世界总览">
            <Globe />
          </button>
          <button
            onClick={handleReflection}
            disabled={isGenerating || !canEnd || reflection?.loading}
            className="btn btn-outline btn-sm" aria-label="剧情回响"
          >
            <span className="hidden sm:inline">剧情回响</span>
            <span className="sm:hidden">回响</span>
          </button>
          <button onClick={() => setShowSidebar(true)} className="btn btn-outline btn-sm" aria-label="角色">
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
            <div className="system-line mb-6">互动至少 4 次后可结束</div>
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
          <div className="max-w-3xl mx-auto">
            <div className="label-mono mb-2 text-[10px]">CHOOSE · 或直接打字</div>
            <div className="flex flex-wrap gap-2">
              {lastChoices.map(choice => (
                <button key={choice.id} onClick={() => handleChoice(choice.text)}
                        className={`btn btn-sm ${choice.isBranchPoint ? 'btn-primary branch-marker pulse-flag' : 'btn-outline'}`}
                        style={{ fontSize: '0.82rem', paddingLeft: choice.isBranchPoint ? '1.25rem' : undefined }}>
                  {choice.text}
                </button>
              ))}
            </div>
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
                <Sparkles width={12} height={12} /> 系统耳语 · 不计入对话
              </div>
              <div className="system-hint-body">
                {systemHint.loading
                  ? <span className="text-[var(--ink-muted)] italic typing-cursor">正在查询</span>
                  : systemHint.answer}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 border-t-[2.5px] border-[var(--ink)] bg-[var(--paper-raised)] px-3 sm:px-5 py-3 pb-safe">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <MentionInput
            ref={inputRef}
            candidates={mentionCandidates}
            placeholder={isGenerating ? '角色正在响应...' : '你想做什么…  (@ 唤出角色 / 系统)'}
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

      {/* 角色侧栏 */}
      {showSidebar && (
        <>
          <div className="fixed inset-0 bg-[rgba(17,17,17,0.5)] z-40 anim-fade-in" onClick={() => setShowSidebar(false)} />
          <aside className="fixed z-50 anim-slide-up bg-[var(--paper)] overflow-hidden flex flex-col
                            right-0 top-0 bottom-0 w-full sm:w-[320px]"
                 style={{ borderLeft: '2.5px solid var(--ink)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b-[2.5px] border-[var(--ink)] bg-[var(--paper-raised)]">
              <div>
                <div className="label-mono text-[10px]">CAST</div>
                <h2 className="font-sans font-bold text-base">角色名册</h2>
              </div>
              <button onClick={() => setShowSidebar(false)} className="btn btn-ghost btn-sm" aria-label="关闭">
                <Close />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {parsedStory.characters.map(char => {
                const interaction = characterInteractions.find(ci => ci.characterId === char.id);
                const isPlayer = char.id === playerConfig.characterId;
                const isPresent = presentNames.has(char.name);
                const isExpanded = expandedCharId === char.id;
                const relationships = char.relationships
                  .map(r => {
                    const target = parsedStory.characters.find(c => c.id === r.characterId);
                    return target ? { name: target.name, relation: r.relation } : null;
                  })
                  .filter((r): r is { name: string; relation: string } => r !== null);
                return (
                  <div key={char.id} className="surface overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedCharId(isExpanded ? null : char.id)}
                      className="w-full p-3 flex gap-3 text-left transition-colors hover:bg-[var(--hi-yellow-soft)]"
                      aria-expanded={isExpanded}
                    >
                      <div className="relative shrink-0">
                        <div className="avatar avatar-md" data-speaker-color={isPlayer ? 'yellow' : speakerColor(char.name)}>{char.name[0]}</div>
                        {!isPlayer && (
                          <span className={`mention-status-dot ${isPresent ? 'is-on' : ''}`}
                                style={{ position: 'absolute', bottom: -3, right: -3, width: 12, height: 12 }} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-sans font-bold text-sm flex items-center gap-2">
                          <span className="truncate">{char.name}</span>
                          {isPlayer && <span className="chip chip-accent" style={{ padding: '1px 6px', fontSize: '0.62rem' }}>YOU</span>}
                        </div>
                        <p className={`text-xs text-[var(--ink-muted)] mt-1 font-serif ${isExpanded ? '' : 'line-clamp-2'}`}>{char.personality}</p>
                        {interaction && interaction.interactions.length > 0 && (
                          <p className="text-[11px] mt-1.5 font-mono">
                            <span className="text-[var(--ink-muted)]">interactions · </span>
                            <span className="font-bold text-[var(--ink)]">{interaction.interactions.length}</span>
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-[var(--ink-muted)] text-xs shrink-0 self-center"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>
                        ▸
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="anim-fade-in border-t-[2.5px] border-[var(--ink)] bg-[var(--paper-softsink)] p-3 space-y-3">
                        {!isPlayer && (
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => {
                                setInterviewDraft('');
                                setInterview({
                                  characterId: char.id,
                                  characterName: char.name,
                                  question: '',
                                  answer: '',
                                  loading: false,
                                });
                                setShowSidebar(false);
                              }}
                              className="btn btn-outline btn-sm"
                              disabled={isGenerating}
                            >
                              <Sparkles width={12} height={12} /> 深问 {char.name}
                            </button>
                          </div>
                        )}
                        {char.description && (
                          <div>
                            <div className="label-mono text-[9.5px] mb-1">描述</div>
                            <p className="font-serif text-sm text-[var(--ink)] leading-relaxed">{char.description}</p>
                          </div>
                        )}
                        {char.background && (
                          <div>
                            <div className="label-mono text-[9.5px] mb-1">背景</div>
                            <p className="font-serif text-sm text-[var(--ink)] leading-relaxed">{char.background}</p>
                          </div>
                        )}
                        {relationships.length > 0 && (
                          <div>
                            <div className="label-mono text-[9.5px] mb-1.5">关系</div>
                            <div className="flex flex-wrap gap-1.5">
                              {relationships.map((r, i) => (
                                <span key={i} className="chip">
                                  <span className="font-bold">{r.name}</span>
                                  <span className="text-[var(--ink-muted)] font-normal">· {r.relation}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {interaction && interaction.interactions.length > 0 && (
                          <div>
                            <div className="label-mono text-[9.5px] mb-1.5">近期互动</div>
                            <ul className="space-y-1.5 font-serif text-xs text-[var(--ink-soft)]">
                              {interaction.interactions.slice(-3).reverse().map((it, i) => (
                                <li key={i} className="pl-2 border-l-2 border-[var(--ink)]">
                                  <span className="font-mono text-[10px] text-[var(--ink-muted)] block">
                                    {it.sentiment === 'positive' ? '+ 好感' : it.sentiment === 'negative' ? '- 嫌隙' : '· 中立'}
                                  </span>
                                  {it.event}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}

      {/* 剧情回响浮层 */}
      {reflection && (
        <div className="fixed inset-0 z-50 bg-[rgba(17,17,17,0.55)] flex items-center justify-center p-4 anim-fade-in"
             onClick={() => setReflection(null)}>
          <div className="surface-raised max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="chapter-head"><span className="ordinal">∞</span> · 剧情回响</span>
              <button onClick={() => setReflection(null)} className="btn btn-ghost btn-sm" aria-label="关闭">
                <Close />
              </button>
            </div>
            {reflection.loading && (
              <p className="font-mono text-sm text-[var(--ink-muted)]">▸ 正在回顾本段剧情…</p>
            )}
            {reflection.error && (
              <p className="font-mono text-sm text-[var(--hi-coral)]">✕ {reflection.error}</p>
            )}
            {reflection.data && (
              <div className="space-y-4">
                <ReflectionBlock label="本段摘要" body={reflection.data.summary} />
                <ReflectionBlock label="玩家影响" body={reflection.data.userImpact} />
                <ReflectionBlock label="情绪基调" body={reflection.data.emotionalEcho} />
                {reflection.data.relationshipChanges.length > 0 && (
                  <div>
                    <div className="label-mono text-[10px] mb-1.5">关系变化</div>
                    <ul className="space-y-1.5 font-serif text-sm">
                      {reflection.data.relationshipChanges.map((rc, i) => (
                        <li key={i} className="pl-2 border-l-2 border-[var(--ink)]">
                          <span className="font-bold">{rc.characterName}</span>
                          {rc.from && rc.to && <span className="text-[var(--ink-muted)]"> · {rc.from} → {rc.to}</span>}
                          {rc.reason && <p className="text-[12px] text-[var(--ink-muted)] mt-0.5">{rc.reason}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {reflection.data.branchHints.length > 0 && (
                  <div>
                    <div className="label-mono text-[10px] mb-1.5">线索方向</div>
                    <ul className="space-y-1 font-serif text-sm list-disc list-inside">
                      {reflection.data.branchHints.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
                {reflection.data.nextSceneSuggestions.length > 0 && (
                  <div>
                    <div className="label-mono text-[10px] mb-1.5">下一幕建议</div>
                    <ul className="space-y-2">
                      {reflection.data.nextSceneSuggestions.map((s, i) => (
                        <li key={i} className="surface p-2.5">
                          <div className="font-sans font-bold text-sm">{s.title}</div>
                          <p className="font-serif text-xs text-[var(--ink-soft)] mt-0.5">{s.hook}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 角色访谈浮层 — 内嵌输入 + 多轮 + 清除答案重问 */}
      {interview && (
        <div className="fixed inset-0 z-50 bg-[rgba(17,17,17,0.55)] flex items-end sm:items-center justify-center p-0 sm:p-4 anim-fade-in"
             onClick={() => setInterview(null)}>
          <div className="surface-raised w-full sm:max-w-lg p-5 sm:rounded-none flex flex-col"
               style={{ maxHeight: '85vh' }}
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <span className="chapter-head"><span className="ordinal">?</span> · 深问 {interview.characterName}</span>
              <button onClick={() => setInterview(null)} className="btn btn-ghost btn-sm" aria-label="关闭">
                <Close />
              </button>
            </div>
            <p className="text-[10px] text-[var(--ink-muted)] font-mono mb-3 shrink-0">
              {'// 访谈不计入剧情、不影响关系；按 Enter 提交，Shift+Enter 换行'}
            </p>

            {/* 历史问答 (只显示当前这轮) */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {interview.question && (
                <div className="surface p-3 bg-[var(--paper-softsink)]">
                  <div className="label-mono text-[10px] mb-1">YOU</div>
                  <p className="font-serif text-sm">{interview.question}</p>
                </div>
              )}
              {interview.loading && (
                <div className="surface p-3">
                  <div className="label-mono text-[10px] mb-1">{interview.characterName.toUpperCase()}</div>
                  <p className="font-mono text-sm text-[var(--ink-muted)] typing-cursor">▸ 思考中</p>
                </div>
              )}
              {!interview.loading && interview.answer && (
                <div className="surface p-3">
                  <div className="label-mono text-[10px] mb-1">{interview.characterName.toUpperCase()}</div>
                  <p className="font-serif text-sm leading-relaxed whitespace-pre-wrap">{interview.answer}</p>
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="mt-3 shrink-0 border-t-[2.5px] border-[var(--ink)] pt-3">
              <textarea
                className="textarea"
                rows={2}
                placeholder={`问 ${interview.characterName} 一个问题…`}
                value={interviewDraft}
                onChange={e => setInterviewDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (interviewDraft.trim() && !interview.loading) {
                      handleInterview(interview.characterId, interviewDraft);
                      setInterviewDraft('');
                    }
                  }
                }}
                disabled={interview.loading}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setInterview(null)}
                  className="btn btn-ghost btn-sm"
                >关闭</button>
                <button
                  onClick={() => {
                    if (interviewDraft.trim()) {
                      handleInterview(interview.characterId, interviewDraft);
                      setInterviewDraft('');
                    }
                  }}
                  disabled={interview.loading || !interviewDraft.trim()}
                  className="btn btn-primary btn-sm"
                >
                  <Send width={14} height={14} /> 发送
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 结束确认 */}
      {endConfirm && (
        <div className="fixed inset-0 z-50 bg-[rgba(17,17,17,0.55)] flex items-center justify-center p-4 anim-fade-in"
             onClick={() => setEndConfirm(false)}>
          <div className="surface-raised max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="stamp mb-3 mx-auto" style={{ transform: 'rotate(-2deg)', width: 'fit-content' }}>
              END OF STORY?
            </div>
            <h3 className="display text-2xl text-center mb-3">确认结束这次游玩？</h3>
            <p className="font-serif text-sm text-[var(--ink-soft)] text-center mb-5">
              AI 将根据你与各角色的互动生成一份后日谈。<br />结束后这次故事不可再继续。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setEndConfirm(false)} className="btn btn-outline">取消</button>
              <button onClick={handleEndStory} className="btn btn-coral">生成后日谈 →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReflectionBlock({ label, body }: { label: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <div className="label-mono text-[10px] mb-1.5">{label}</div>
      <p className="font-serif text-sm leading-relaxed">{body}</p>
    </div>
  );
}
