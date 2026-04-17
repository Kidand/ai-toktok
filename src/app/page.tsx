'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { LLMProvider, GameSave } from '@/lib/types';
import { loadStory, deleteSave } from '@/lib/storage';
import { parseStoryClient } from '@/lib/parser-client';
import { Upload, Book, Trash, Play, CheckCircle } from '@/components/Icons';

export default function HomePage() {
  const router = useRouter();
  const {
    llmConfig, setLLMConfig, setParsedStory, setIsParsing, isParsing,
    saves, loadSaves, loadFromSave, init,
  } = useGameStore();

  const [mounted, setMounted] = useState(false);
  const [provider, setProvider] = useState<LLMProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [storyText, setStoryText] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [parseProgress, setParseProgress] = useState<{ phase: string; current: number; total: number; resumedFrom?: number; retrying?: number; characters?: number }>({ phase: '', current: 0, total: 0 });
  const [tab, setTab] = useState<'new' | 'saves'>('new');
  const [showApiDetails, setShowApiDetails] = useState(false);

  useEffect(() => { init(); setMounted(true); }, [init]);

  useEffect(() => {
    if (llmConfig) {
      setProvider(llmConfig.provider);
      setApiKey(llmConfig.apiKey);
      setModel(llmConfig.model);
      setBaseUrl(llmConfig.baseUrl || '');
    }
  }, [llmConfig]);

  const defaultModel = provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514';

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setStoryText(ev.target?.result as string);
    reader.readAsText(file);
  }, []);

  const canStart = !!apiKey.trim() && !!storyText.trim();

  const handleStart = async () => {
    if (!canStart) return;
    setError('');
    setParseProgress({ phase: '', current: 0, total: 0 });

    const config = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || defaultModel,
      baseUrl: baseUrl.trim() || undefined,
    };
    setLLMConfig(config);
    setIsParsing(true);

    try {
      const result = await parseStoryClient(config, storyText, (p) => setParseProgress(p));
      setParsedStory(result);
      router.push('/setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : '故事解析失败');
    } finally {
      setIsParsing(false);
    }
  };

  const handleLoadSave = (save: GameSave) => {
    const story = loadStory(save.storyId);
    if (!story) { setError('找不到对应的故事数据'); return; }
    if (!llmConfig && !apiKey.trim()) { setError('请先配置 API 密钥'); return; }
    if (!llmConfig) {
      setLLMConfig({ provider, apiKey: apiKey.trim(), model: model.trim() || defaultModel, baseUrl: baseUrl.trim() || undefined });
    }
    loadFromSave(save, story);
    router.push('/play');
  };

  const handleDeleteSave = (saveId: string) => {
    if (!confirm('确定删除这个存档？')) return;
    deleteSave(saveId);
    loadSaves();
  };

  if (!mounted) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">加载中...</div>;
  }

  const progressPct = parseProgress.phase === 'split' ? 3
    : parseProgress.phase === 'parse' ? Math.max(5, (parseProgress.current / Math.max(1, parseProgress.total)) * 88)
    : parseProgress.phase === 'polish' ? 94
    : parseProgress.phase === 'build' ? 100
    : 0;

  return (
    <div className="min-h-screen flex flex-col safe-top">
      {/* Hero */}
      <header className="px-4 sm:px-6 pt-10 sm:pt-16 pb-8 max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <span className="stamp">issue 01 · 2026</span>
          <span className="stamp" style={{ transform: 'rotate(1deg)', background: 'var(--hi-yellow)' }}>
            handmade
          </span>
        </div>

        <h1 className="display text-[3.5rem] sm:text-[5rem] md:text-[6rem] leading-[0.88] mb-6">
          AI<br />
          <span className="inline-block bg-[var(--hi-yellow)] border-[2.5px] border-[var(--ink)] px-3 py-1" style={{ boxShadow: '6px 6px 0 var(--ink)' }}>
            TOK TOK
          </span>
        </h1>

        <p className="text-lg sm:text-xl leading-snug text-[var(--ink-soft)] max-w-xl font-sans">
          一份可阅读、可介入、可分岔的互动文学刊物 ——
          <br className="hidden sm:inline" />
          上传你手里的故事，穿越进去扮演一个角色，每一次决定都被记录成你独有的那一章。
        </p>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pb-12 space-y-10">
        {/* Section 01 · API */}
        <section>
          <SectionHead n="01" title="装配 · AI 引擎" />
          <div className="surface p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <span className="label-mono">MODEL · KEY · ENDPOINT</span>
              {llmConfig && (
                <span className="chip chip-mint">
                  <CheckCircle width={12} height={12} /> 已配置
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <FormField label="PROVIDER">
                <select className="select" value={provider} onChange={e => setProvider(e.target.value as LLMProvider)}>
                  <option value="openai">OpenAI / 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </FormField>
              <FormField label="MODEL">
                <input className="input" type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={defaultModel} />
              </FormField>
            </div>

            <FormField label="API KEY">
              <input className="input input-mono" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'} />
            </FormField>

            <button onClick={() => setShowApiDetails(s => !s)}
                    className="mt-3 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] font-mono underline underline-offset-4 decoration-dashed">
              {showApiDetails ? '[ - ] 收起高级' : '[ + ] 高级（自定义接口地址）'}
            </button>
            {showApiDetails && (
              <div className="mt-3 anim-fade-in">
                <FormField label="BASE URL">
                  <input className="input input-mono" type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                         placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'} />
                </FormField>
                <p className="text-xs text-[var(--ink-muted)] mt-2 font-mono leading-relaxed">
                  支持 DeepSeek · Moonshot · OpenRouter · 本地 Ollama 等兼容 OpenAI 格式的接口
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Tabs */}
        <section>
          <div className="flex items-stretch gap-2">
            <TabButton active={tab === 'new'} onClick={() => setTab('new')}>
              <Book width={16} height={16} />新故事
            </TabButton>
            <TabButton active={tab === 'saves'} onClick={() => { setTab('saves'); loadSaves(); }}>
              <ClockIcon /> 存档 {saves.length > 0 && <span className="font-mono text-sm">({saves.length})</span>}
            </TabButton>
          </div>
        </section>

        {/* Tab content */}
        {tab === 'new' && (
          <section className="anim-fade-in">
            <SectionHead n="02" title="投稿 · 上传故事" />

            <label className="block choice-card text-center cursor-pointer p-7 mb-4" style={{ borderStyle: fileName ? 'solid' : 'dashed' }}>
              <input type="file" accept=".txt,.md,.text" onChange={handleFileUpload} className="hidden" />
              {fileName ? (
                <>
                  <CheckCircle className="mx-auto mb-2" style={{ color: 'var(--ink)' }} width={26} height={26} />
                  <p className="font-sans font-bold text-[var(--ink)]">{fileName}</p>
                  <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">点击重新选择</p>
                </>
              ) : (
                <>
                  <Upload className="mx-auto mb-2 text-[var(--ink-muted)]" width={26} height={26} />
                  <p className="font-sans font-bold text-[var(--ink)]">拖 / 点击上传文本</p>
                  <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">.txt · .md</p>
                </>
              )}
            </label>

            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-[2px] bg-[var(--ink)]" />
              <span className="label-mono">OR · PASTE</span>
              <div className="flex-1 h-[2px] bg-[var(--ink)]" />
            </div>

            <textarea className="textarea" value={storyText} onChange={e => setStoryText(e.target.value)}
                      placeholder="在此粘贴故事原文……" rows={6} />

            {error && (
              <div className="mt-3 p-3 border-[2.5px] border-[var(--ink)] bg-[var(--hi-coral-soft)] font-mono text-sm">
                ⚠ {error}
              </div>
            )}

            {isParsing && parseProgress.phase && (
              <div className="mt-4 anim-fade-in">
                <div className="flex justify-between items-center text-xs font-mono gap-2 mb-1.5">
                  <span className="truncate text-[var(--ink)] font-bold tracking-wider">
                    {parseProgress.phase === 'split' && '▸ 切片中'}
                    {parseProgress.phase === 'parse' && (
                      parseProgress.total === 1
                        ? '▸ 解析中'
                        : `▸ 第 ${parseProgress.current.toFixed(2)}/${parseProgress.total} 段`
                    )}
                    {parseProgress.phase === 'polish' && '▸ 润色统稿'}
                    {parseProgress.phase === 'build' && '▸ 构建世界'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {parseProgress.phase === 'parse' && parseProgress.characters !== undefined && parseProgress.characters > 0 && (
                      <span className="chip">{parseProgress.characters} 角色</span>
                    )}
                    {parseProgress.resumedFrom !== undefined && (
                      <span className="chip chip-mint">续传 @{parseProgress.resumedFrom}</span>
                    )}
                    {parseProgress.retrying && (
                      <span className="chip chip-coral">重试 #{parseProgress.retrying}</span>
                    )}
                    <span className="font-mono text-sm font-bold tabular-nums">{Math.round(progressPct)}%</span>
                  </div>
                </div>
                <div className="ticked-progress">
                  <div className="ticked-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                {parseProgress.phase === 'parse' && parseProgress.total > 1 && (
                  <p className="text-[11px] text-[var(--ink-muted)] mt-2 font-mono">
                    {'// 每段基于前序图谱增量合并 · 失败自动重试 · 成功已缓存'}
                  </p>
                )}
              </div>
            )}

            <button onClick={handleStart} disabled={isParsing || !canStart}
                    className="btn btn-primary btn-lg btn-block mt-5">
              {isParsing
                ? (parseProgress.total > 1 ? `解析中 ${Math.floor(parseProgress.current)}/${parseProgress.total}` : '正在解析...')
                : !apiKey.trim()
                  ? '请先填写 API 密钥'
                  : !storyText.trim()
                    ? '请先上传或粘贴故事'
                    : <><Play width={16} height={16} />进入故事世界 →</>}
            </button>
          </section>
        )}

        {tab === 'saves' && (
          <section className="anim-fade-in">
            <SectionHead n="02" title="档案 · 历次游玩" />
            {saves.length === 0 ? (
              <div className="surface p-10 text-center">
                <Book className="mx-auto mb-3 text-[var(--ink-faint)]" width={32} height={32} />
                <p className="font-sans font-bold">暂无存档</p>
                <p className="text-xs text-[var(--ink-muted)] mt-1 font-mono">开始一个新故事，自动存进这里</p>
              </div>
            ) : (
              <div className="space-y-3">
                {saves.map((save, i) => (
                  <article key={save.id} className="surface p-4"
                           style={{ transform: i % 2 === 0 ? 'rotate(-0.25deg)' : 'rotate(0.3deg)' }}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-sans font-bold text-base truncate">{save.storyTitle}</h3>
                        <div className="flex items-center gap-2 text-[11px] mt-1.5 flex-wrap font-mono">
                          {save.isCompleted
                            ? <span className="chip chip-mint">已完结</span>
                            : <span className="chip chip-accent">{save.narrativeHistory.length} 条记录</span>}
                          <span className="text-[var(--ink-muted)]">
                            {new Date(save.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteSave(save.id)} className="btn btn-ghost btn-sm btn-danger" aria-label="删除">
                        <Trash width={16} height={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => handleLoadSave(save)} className="btn btn-primary btn-sm">
                        {save.isCompleted ? '重读' : '继续'}
                      </button>
                      <button onClick={() => router.push(`/archive?id=${save.id}`)} className="btn btn-outline btn-sm">
                        回顾
                      </button>
                      {save.isCompleted && save.epilogue ? (
                        <button onClick={() => {
                          const story = loadStory(save.storyId);
                          if (story) { loadFromSave(save, story); router.push('/epilogue'); }
                        }} className="btn btn-cyan btn-sm">
                          后日谈
                        </button>
                      ) : <div />}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="border-t-[2.5px] border-[var(--ink)] bg-[var(--paper-sunken)] py-4 px-6 text-center font-mono text-[11px] text-[var(--ink-muted)] pb-safe">
        {'// API KEYS STAY IN YOUR BROWSER · NO SERVER · NO ACCOUNTS'}
      </footer>
    </div>
  );
}

function SectionHead({ n, title }: { n: string; title: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="chapter-head"><span className="ordinal">{n}</span> · {title}</span>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-mono block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            className={active ? 'btn btn-primary btn-block' : 'btn btn-outline btn-block'}>
      {children}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
