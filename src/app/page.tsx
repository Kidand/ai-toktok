'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { LLMProvider, GameSave } from '@/lib/types';
import { loadStory, deleteSave } from '@/lib/storage';
import { parseStoryClient } from '@/lib/parser-client';
import { Upload, Book, Trash, Play, Sparkles, CheckCircle } from '@/components/Icons';

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
  const [parseProgress, setParseProgress] = useState({ phase: '', current: 0, total: 0 });
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

  const handleStart = async () => {
    if (!apiKey.trim()) { setError('请输入 API 密钥'); return; }
    if (!storyText.trim()) { setError('请上传或粘贴故事文本'); return; }
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
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">加载中...</div>
    );
  }

  const progressPct = parseProgress.phase === 'split' ? 5
    : parseProgress.phase === 'parse' ? Math.max(10, (parseProgress.current / Math.max(1, parseProgress.total)) * 80)
    : parseProgress.phase === 'merge' ? 90
    : parseProgress.phase === 'build' ? 100
    : 0;

  return (
    <div className="min-h-screen flex flex-col safe-top">
      {/* Hero */}
      <header className="px-6 pt-16 pb-8 text-center">
        <div className="inline-flex items-center gap-2 chip chip-accent mb-5">
          <Sparkles width={14} height={14} />
          沉浸式互动叙事沙盒
        </div>
        <h1 className="font-serif text-5xl md:text-6xl font-bold tracking-wider mb-3"
            style={{
              background: 'linear-gradient(145deg, var(--accent-strong), var(--accent), #c9885a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
          AI TokTok
        </h1>
        <p className="text-muted text-base md:text-lg max-w-xl mx-auto leading-relaxed">
          穿越进入任意故事世界，与角色实时互动，<br className="hidden sm:inline" />
          让 AI 为你生成独一无二的分支剧情。
        </p>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 pb-12 space-y-5">
        {/* API 配置 */}
        <section className="surface p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="label">AI 引擎配置</h2>
            {llmConfig && (
              <span className="chip chip-teal">
                <CheckCircle width={12} height={12} />已配置
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-muted mb-1.5 font-sans">提供商</label>
              <select className="select" value={provider} onChange={e => setProvider(e.target.value as LLMProvider)}>
                <option value="openai">OpenAI / 兼容接口</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5 font-sans">模型</label>
              <input className="input" type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={defaultModel} />
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-muted mb-1.5 font-sans">API 密钥</label>
            <input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'} />
          </div>

          <button onClick={() => setShowApiDetails(s => !s)} className="text-xs text-muted hover:text-foreground font-sans transition-colors">
            {showApiDetails ? '收起高级设置' : '高级设置 (自定义接口地址)'}
          </button>
          {showApiDetails && (
            <div className="mt-3 anim-fade-in">
              <label className="block text-xs text-muted mb-1.5 font-sans">API 地址 <span className="text-muted-dim">(留空使用官方)</span></label>
              <input className="input" type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                     placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'} />
              <p className="text-xs text-muted-dim mt-2 leading-relaxed">
                支持 DeepSeek · Moonshot · OpenRouter · 本地 Ollama 等兼容 OpenAI 格式的接口
              </p>
            </div>
          )}
        </section>

        {/* Tab */}
        <div className="grid grid-cols-2 gap-2 p-1 surface" style={{ padding: '4px' }}>
          <button
            onClick={() => setTab('new')}
            className={`btn btn-sm ${tab === 'new' ? 'btn-primary' : 'btn-ghost'}`}
          >
            <Book width={16} height={16} />新故事
          </button>
          <button
            onClick={() => { setTab('saves'); loadSaves(); }}
            className={`btn btn-sm ${tab === 'saves' ? 'btn-primary' : 'btn-ghost'}`}
          >
            <Clock /> 存档 {saves.length > 0 && `(${saves.length})`}
          </button>
        </div>

        {/* 新故事 */}
        {tab === 'new' && (
          <section className="surface p-5 sm:p-6 anim-fade-in">
            <h2 className="label mb-4">上传故事</h2>

            <label className="block surface p-6 border-2 border-dashed text-center cursor-pointer mb-4 transition-colors hover:border-accent/50"
                   style={{ background: 'var(--surface-2)' }}>
              <input type="file" accept=".txt,.md,.text" onChange={handleFileUpload} className="hidden" />
              {fileName ? (
                <>
                  <CheckCircle className="mx-auto mb-2 text-teal" style={{ color: 'var(--teal)' }} />
                  <p className="text-foreground text-sm">{fileName}</p>
                  <p className="text-xs text-muted mt-1 font-sans">点击重新选择</p>
                </>
              ) : (
                <>
                  <Upload className="mx-auto mb-2 text-muted" />
                  <p className="text-foreground text-sm">点击上传故事文件</p>
                  <p className="text-xs text-muted mt-1 font-sans">支持 .txt · .md</p>
                </>
              )}
            </label>

            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-dim font-sans">或直接粘贴文本</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <textarea className="textarea" value={storyText} onChange={e => setStoryText(e.target.value)}
                      placeholder="在此粘贴故事文本..." rows={6} />

            {error && (
              <p className="text-sm mt-3 px-3 py-2 rounded-lg" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                {error}
              </p>
            )}

            {isParsing && parseProgress.phase && (
              <div className="mt-4 space-y-2 anim-fade-in">
                <div className="flex justify-between text-xs text-muted font-sans">
                  <span>
                    {parseProgress.phase === 'split' && '正在分割文本...'}
                    {parseProgress.phase === 'parse' && `正在解析第 ${parseProgress.current}/${parseProgress.total} 段...`}
                    {parseProgress.phase === 'merge' && '正在合并分析结果...'}
                    {parseProgress.phase === 'build' && '正在构建故事世界...'}
                  </span>
                  <span className="text-accent">{Math.round(progressPct)}%</span>
                </div>
                <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                       style={{ background: 'linear-gradient(90deg, var(--accent-strong), var(--accent))', width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            <button onClick={handleStart} disabled={isParsing} className="btn btn-primary btn-lg btn-block mt-5">
              {isParsing
                ? (parseProgress.total > 1 ? `解析中 ${parseProgress.current}/${parseProgress.total}` : '正在解析...')
                : (<><Play width={16} height={16} />进入故事世界</>)}
            </button>
          </section>
        )}

        {/* 存档列表 */}
        {tab === 'saves' && (
          <section className="anim-fade-in">
            {saves.length === 0 ? (
              <div className="surface p-10 text-center">
                <Book className="mx-auto mb-3 text-muted-dim" width={32} height={32} />
                <p className="text-muted">暂无存档</p>
                <p className="text-xs text-muted-dim mt-1 font-sans">开始一个新故事，它会自动保存到这里</p>
              </div>
            ) : (
              <div className="space-y-3">
                {saves.map(save => (
                  <div key={save.id} className="surface p-4 hover:border-accent/30 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold truncate">{save.storyTitle}</h3>
                        <div className="flex items-center gap-2 text-xs text-muted mt-1 flex-wrap font-sans">
                          {save.isCompleted
                            ? <span className="chip chip-teal">已完结</span>
                            : <span className="chip">{save.narrativeHistory.length} 条记录</span>}
                          <span>{new Date(save.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
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
                        }} className="btn btn-outline btn-sm" style={{ color: 'var(--teal)', borderColor: 'color-mix(in oklab, var(--teal) 30%, transparent)' }}>
                          后日谈
                        </button>
                      ) : <div />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="text-center text-xs text-muted-dim py-6 font-sans pb-safe">
        API 密钥仅保存在本地浏览器 · 纯客户端应用
      </footer>
    </div>
  );
}

function Clock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
