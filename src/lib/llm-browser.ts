/** 浏览器端直接调用 LLM API */

import { LLMConfig } from './types';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

export async function callLLMBrowser(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  let full = '';
  for await (const token of streamLLMBrowser(config, systemPrompt, userMessage, options)) {
    full += token;
  }
  return full;
}

export async function* streamLLMBrowser(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<string> {
  const temp = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;

  if (config.provider === 'openai') {
    yield* streamOpenAI(config, systemPrompt, userMessage, temp, maxTokens);
  } else {
    yield* streamAnthropic(config, systemPrompt, userMessage, temp, maxTokens);
  }
}

async function* streamOpenAI(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
): AsyncGenerator<string> {
  const base = config.baseUrl?.replace(/\/+$/, '') || DEFAULT_OPENAI_BASE;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API 错误: ${res.status} ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) yield content;
      } catch { /* skip */ }
    }
  }
}

async function* streamAnthropic(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
): AsyncGenerator<string> {
  const base = config.baseUrl?.replace(/\/+$/, '') || DEFAULT_ANTHROPIC_BASE;
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-20250514',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API 错误: ${res.status} ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.type === 'content_block_delta') {
          const text = parsed.delta?.text || '';
          if (text) yield text;
        }
      } catch { /* skip */ }
    }
  }
}
