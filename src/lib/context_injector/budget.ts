/**
 * Lightweight token accounting for the context injector.
 *
 * We deliberately do NOT pull in a real tokenizer here — `gpt-tokenizer`
 * adds ~250 KB of bundle weight and the values we need are routing
 * decisions, not exact billing. Chinese-heavy prompts in this app run
 * roughly 1.6-2.0 chars per token across both gpt-4o and Claude; 1.8 is
 * a conservative middle.
 *
 * If a future phase needs exact accounting, swap `estimateTokens()` for
 * a wasm tokenizer call — every caller goes through this function.
 */

const CHARS_PER_TOKEN = 1.8;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * A typed budget for the five-tier injector. Per-layer caps prevent any
 * single layer from monopolising the prompt; the composer trims layers
 * starting from the lowest priority (L4) once total exceeds `total`.
 */
export interface TokenBudget {
  total: number;
  L0: number;
  L1: number;
  L2: number;
  L3: number;
  L4: number;
}

export const DEFAULT_BUDGET: TokenBudget = {
  total: 3900,
  L0: 800,
  L1: 400,
  L2: 1500,
  L3: 600,
  L4: 600,
};

/**
 * Trim a string so its estimated token count fits the cap. Truncation is
 * line-wise from the end — keeps the head readable. When even one line
 * is over budget, falls back to char slicing.
 */
export function trimToBudget(text: string, capTokens: number): string {
  if (estimateTokens(text) <= capTokens) return text;
  const lines = text.split('\n');
  let acc = '';
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokens(line) + 1; // +1 for the newline
    if (used + cost > capTokens) break;
    acc += (acc ? '\n' : '') + line;
    used += cost;
  }
  if (!acc) {
    // Single oversized line — slice characters.
    return text.slice(0, Math.floor(capTokens * CHARS_PER_TOKEN));
  }
  return acc + '\n…（已截断）';
}
