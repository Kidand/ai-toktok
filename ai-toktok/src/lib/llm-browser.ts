/** 浏览器端直接调用 LLM API（绕过 Next.js 服务器超时） */

import { LLMConfig } from './types';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

export async function callLLMBrowser(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const temp = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;

  if (config.provider === 'openai') {
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
        temperature: temp,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 错误: ${res.status} ${err}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  // Anthropic
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
      temperature: temp,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API 错误: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}
