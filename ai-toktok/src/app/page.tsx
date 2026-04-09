'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { LLMProvider, GameSave } from '@/lib/types';
import { loadStory, deleteSave } from '@/lib/storage';
import { parseStoryClient } from '@/lib/parser-client';

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
    reader.onload = (ev) => {
      setStoryText(ev.target?.result as string);
    };
    reader.readAsText(file);
  }, []);

  const handleStart = async () => {
    if (!apiKey.trim()) {
      setError('请输入 API 密钥');
      return;
    }
    if (!storyText.trim()) {
      setError('请上传或粘贴故事文本');
      return;
    }
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
    if (!story) {
      setError('找不到对应的故事数据');
      return;
    }
    if (!llmConfig && !apiKey.trim()) {
      setError('请先配置 API 密钥');
      return;
    }
    if (!llmConfig) {
      setLLMConfig({ provider, apiKey: apiKey.trim(), model: model.trim() || defaultModel, baseUrl: baseUrl.trim() || undefined });
    }
    loadFromSave(save, story);
    router.push('/play');
  };

  const handleDeleteSave = (saveId: string) => {
    deleteSave(saveId);
    loadSaves();
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      {/* 标题 */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold mb-2 tracking-wider" style={{ color: 'var(--accent)' }}>
          AI TokTok
        </h1>
        <p className="text-muted text-lg">沉浸式IP互动叙事沙盒</p>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)', opacity: 0.6 }}>
          穿越进入任意故事世界，与角色实时互动
        </p>
      </div>

      {/* API 配置 */}
      <div className="w-full max-w-2xl bg-card-bg border border-card-border rounded-xl p-6 mb-6">
        <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">AI 引擎配置</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-muted mb-1">提供商</label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as LLMProvider)}
              className="w-full bg-input-bg border border-card-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent"
            >
              <option value="openai">OpenAI / 兼容接口</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">模型</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={defaultModel}
              className="w-full bg-input-bg border border-card-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-muted mb-1">API 地址 <span className="text-muted/50">(留空使用官方默认)</span></label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'}
            className="w-full bg-input-bg border border-card-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--muted)', opacity: 0.5 }}>
            支持 DeepSeek、Moonshot、OpenRouter、本地 Ollama 等兼容 OpenAI 格式的接口
          </p>
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">API 密钥</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
            className="w-full bg-input-bg border border-card-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="w-full max-w-2xl flex gap-2 mb-4">
        <button
          onClick={() => setTab('new')}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${
            tab === 'new' ? 'bg-accent text-black font-medium' : 'bg-card-bg text-muted hover:text-foreground'
          }`}
        >
          新故事
        </button>
        <button
          onClick={() => { setTab('saves'); loadSaves(); }}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${
            tab === 'saves' ? 'bg-accent text-black font-medium' : 'bg-card-bg text-muted hover:text-foreground'
          }`}
        >
          存档 ({saves.length})
        </button>
      </div>

      {/* 新故事 */}
      {tab === 'new' && (
        <div className="w-full max-w-2xl bg-card-bg border border-card-border rounded-xl p-6">
          <h2 className="text-sm font-medium text-muted mb-4 uppercase tracking-widest">上传故事</h2>

          <label className="block border-2 border-dashed border-card-border rounded-xl p-8 text-center cursor-pointer hover:border-accent/50 transition-colors mb-4">
            <input
              type="file"
              accept=".txt,.md,.text"
              onChange={handleFileUpload}
              className="hidden"
            />
            {fileName ? (
              <p className="text-foreground">{fileName}</p>
            ) : (
              <>
                <p className="text-muted mb-1">点击上传故事文件</p>
                <p className="text-sm" style={{ color: 'var(--muted)', opacity: 0.5 }}>支持 .txt, .md 格式</p>
              </>
            )}
          </label>

          <div className="text-center text-muted text-sm mb-4">或直接粘贴文本</div>

          <textarea
            value={storyText}
            onChange={e => setStoryText(e.target.value)}
            placeholder="在此粘贴故事文本..."
            rows={8}
            className="w-full bg-input-bg border border-card-border rounded-lg px-4 py-3 text-foreground text-sm resize-none focus:outline-none focus:border-accent leading-relaxed"
          />

          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}

          {/* 解析进度条 */}
          {isParsing && parseProgress.phase && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {parseProgress.phase === 'split' && '正在分割文本...'}
                  {parseProgress.phase === 'parse' && `正在解析第 ${parseProgress.current}/${parseProgress.total} 段...`}
                  {parseProgress.phase === 'merge' && '正在合并分析结果...'}
                  {parseProgress.phase === 'build' && '正在构建故事世界...'}
                </span>
                <span>
                  {parseProgress.phase === 'parse'
                    ? `${Math.round((parseProgress.current / parseProgress.total) * 100)}%`
                    : ''}
                </span>
              </div>
              <div className="w-full h-2 bg-card-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    background: 'var(--accent)',
                    width: parseProgress.phase === 'split' ? '5%'
                      : parseProgress.phase === 'parse' ? `${Math.max(10, (parseProgress.current / parseProgress.total) * 80)}%`
                      : parseProgress.phase === 'merge' ? '90%'
                      : '100%',
                  }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={isParsing}
            className="w-full mt-4 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: isParsing ? 'var(--accent-dim)' : 'var(--accent)',
              color: 'black',
            }}
          >
            {isParsing
              ? (parseProgress.total > 1
                ? `正在解析 (${parseProgress.current}/${parseProgress.total})...`
                : '正在解析故事世界...')
              : '进入故事世界'}
          </button>
        </div>
      )}

      {/* 存档列表 */}
      {tab === 'saves' && (
        <div className="w-full max-w-2xl">
          {saves.length === 0 ? (
            <div className="bg-card-bg border border-card-border rounded-xl p-8 text-center text-muted">
              暂无存档
            </div>
          ) : (
            <div className="space-y-3">
              {saves.map(save => (
                <div
                  key={save.id}
                  className="bg-card-bg border border-card-border rounded-xl p-4 flex items-center justify-between hover:border-accent/30 transition-colors"
                >
                  <div className="flex-1">
                    <h3 className="font-medium">{save.storyTitle}</h3>
                    <p className="text-sm text-muted mt-1">
                      {save.isCompleted ? '已完结' : `${save.narrativeHistory.length} 条记录`}
                      {' · '}
                      {new Date(save.updatedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {save.isCompleted && save.epilogue && (
                      <button
                        onClick={() => {
                          const story = loadStory(save.storyId);
                          if (story) {
                            loadFromSave(save, story);
                            router.push('/epilogue');
                          }
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg text-accent hover:bg-accent/10 transition-colors"
                      >
                        后日谈
                      </button>
                    )}
                    <button
                      onClick={() => handleLoadSave(save)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-accent text-black hover:opacity-80 transition-colors"
                    >
                      {save.isCompleted ? '重读' : '继续'}
                    </button>
                    <button
                      onClick={() => router.push(`/archive?id=${save.id}`)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-card-border text-foreground hover:opacity-80 transition-colors"
                    >
                      回顾
                    </button>
                    <button
                      onClick={() => handleDeleteSave(save.id)}
                      className="px-3 py-1.5 text-sm rounded-lg text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
