/**
 * Low-level LLM text helpers shared across the narration pipeline.
 *
 * Extracted out of narrator-browser to break a require-cycle: narrator-browser
 * now imports the protocol parser (src/lib/narration_protocol), and that parser
 * in turn needs `stripThinking` + the streaming types. Putting these leaf
 * primitives in their own module makes the dependency a DAG again. narrator-
 * browser re-exports all three so existing importers keep working unchanged.
 */

export type StreamingDialogue = { speaker: string; content: string; partial?: boolean };
export type StreamingState = {
  narration: string;
  dialogues: StreamingDialogue[];
};

/**
 * Strip reasoning-model thinking prefixes from a response buffer.
 *
 * Reasoning-capable models served through OpenAI-compatible endpoints
 * (DeepSeek-R1, MiniMax-M2, some Qwen/GLM tunes) often mix their chain-of-
 * thought into the primary content stream, typically wrapped in
 * `<think>...</think>` or `<thinking>...</thinking>` tags. That scrambles
 * our JSON parsing.
 *
 * This helper removes:
 *   - any complete `<think>…</think>` / `<thinking>…</thinking>` blocks
 *   - any trailing unclosed `<think(...)` — mid-stream, thinking is still
 *     being written and nothing after it is the real answer yet, so drop
 *     from the opening tag onward
 *
 * Case-insensitive. Safe to call on a partial buffer (streaming) or on a
 * completed response.
 */
export function stripThinking(buffer: string): string {
  // Complete blocks — greedy removal
  let out = buffer.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
  // Unclosed trailing block — chop from the opener
  const open = out.match(/<think(?:ing)?\b[^>]*>/i);
  if (open && open.index !== undefined) out = out.slice(0, open.index);
  return out;
}
