/** 浏览器端直接调用 LLM API */

import { LLMConfig } from './types';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

/** 最小化调用，用于校验 key / base url / model 是否可用。*/
export async function verifyLLMConfig(config: LLMConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
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
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      if (!res.ok) {
        const txt = (await res.text()).slice(0, 240);
        return { ok: false, error: `${res.status} ${txt}` };
      }
      return { ok: true };
    }
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
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 240);
      return { ok: false, error: `${res.status} ${txt}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Optional activity callback. Reasoning-capable models (DeepSeek-R1 /
 * deepseek-v4-flash, MiniMax-M, Qwen-reasoning, …) emit thinking tokens
 * on a separate `delta.reasoning_content` channel that we deliberately
 * don't append to the produced buffer (it would leak into JSON parsers).
 * But silently dropping those bytes makes the UI look frozen for 30-90s
 * during the model's first thinking pass. `onActivity('reasoning')`
 * fires once per reasoning token so the caller can flash a "思考中" hint.
 *
 * `onActivity('content')` fires per visible content token — strictly
 * redundant with `yield`, but useful for callers that don't consume the
 * iterator directly.
 */
export type LLMStreamActivity = 'reasoning' | 'content';

/**
 * Prior turns for multi-turn chat. Inserted between the system prompt
 * and the new user message; preserves the chronological order. Use this
 * when implementing follow-up dialogue (e.g. agent interview where the
 * NPC must remember what was just said).
 */
export interface PriorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  onActivity?: (kind: LLMStreamActivity) => void;
  priorMessages?: PriorMessage[];
}

export async function callLLMBrowser(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  options?: LLMCallOptions,
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
  options?: LLMCallOptions,
): AsyncGenerator<string> {
  const temp = options?.temperature ?? 0.7;
  const maxTokens = options?.maxTokens ?? 4096;
  const onActivity = options?.onActivity;

  const priorMessages = options?.priorMessages;
  if (config.provider === 'openai') {
    yield* streamOpenAI(config, systemPrompt, userMessage, temp, maxTokens, onActivity, priorMessages);
  } else {
    yield* streamAnthropic(config, systemPrompt, userMessage, temp, maxTokens, onActivity, priorMessages);
  }
}

async function* streamOpenAI(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
  onActivity?: (kind: LLMStreamActivity) => void,
  priorMessages?: PriorMessage[],
): AsyncGenerator<string> {
  const base = config.baseUrl?.replace(/\/+$/, '') || DEFAULT_OPENAI_BASE;
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...(priorMessages || []),
    { role: 'user', content: userMessage },
  ];
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o',
      messages,
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
  let contentSeen = false;
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') {
        if (!contentSeen) {
          // Reasoning model burned the entire budget on thinking — common
          // failure mode for deepseek-v4-flash with maxTokens too low.
          throw new Error(
            `LLM 返回为空（finish_reason=${finishReason || 'unknown'}）。`
            + ' 推理模型可能把所有 token 都用在了思考阶段；尝试调高 maxTokens，'
            + '或换非推理模型（如 deepseek-chat）。',
          );
        }
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        // Reasoning channel — surfaces only as a heartbeat to the caller.
        if (delta?.reasoning_content) onActivity?.('reasoning');
        const content = delta?.content || '';
        if (content) {
          contentSeen = true;
          onActivity?.('content');
          yield content;
        }
        // Capture finish_reason so the empty-response error above is precise.
        const fr = parsed.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
      } catch { /* skip non-JSON keep-alive lines */ }
    }
  }
  // Stream closed without a [DONE] sentinel — uncommon but possible
  // (e.g. proxy buffering). If we never saw any content, surface the
  // same "empty response" error as the [DONE]-without-content branch.
  if (!contentSeen) {
    throw new Error(
      `LLM 返回为空（finish_reason=${finishReason || 'stream_closed'}）。`
      + ' 推理模型可能把所有 token 都用在了思考阶段；尝试调高 maxTokens，'
      + '或换非推理模型（如 deepseek-chat）。',
    );
  }
}

async function* streamAnthropic(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
  onActivity?: (kind: LLMStreamActivity) => void,
  priorMessages?: PriorMessage[],
): AsyncGenerator<string> {
  const base = config.baseUrl?.replace(/\/+$/, '') || DEFAULT_ANTHROPIC_BASE;
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...(priorMessages || []),
    { role: 'user', content: userMessage },
  ];
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
      messages,
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
  let contentSeen = false;
  let stopReason: string | null = null;

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
          // Anthropic's extended-thinking blocks come on `thinking_delta`.
          // Surface them as a heartbeat only — don't yield.
          if (parsed.delta?.type === 'thinking_delta' || parsed.delta?.thinking) {
            onActivity?.('reasoning');
            continue;
          }
          const text = parsed.delta?.text || '';
          if (text) {
            contentSeen = true;
            onActivity?.('content');
            yield text;
          }
        } else if (parsed.type === 'message_delta') {
          if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
        } else if (parsed.type === 'message_stop') {
          if (!contentSeen) {
            throw new Error(
              `LLM 返回为空（stop_reason=${stopReason || 'unknown'}）。`
              + ' 模型可能把所有 token 都用在了思考阶段；尝试调高 maxTokens。',
            );
          }
          return;
        }
      } catch (err) {
        // Re-throw the explicit empty-response error so callers see it.
        if (err instanceof Error && err.message.startsWith('LLM 返回为空')) throw err;
        // Otherwise: malformed keep-alive line, ignore.
      }
    }
  }
  if (!contentSeen) {
    throw new Error(
      `LLM 返回为空（stop_reason=${stopReason || 'stream_closed'}）。`
      + ' 模型可能把所有 token 都用在了思考阶段；尝试调高 maxTokens。',
    );
  }
}
