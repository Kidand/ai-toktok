/**
 * Central telemetry sink. Every module in the refactored pipeline emits
 * structured events through `logEvent` so a future debug panel can show
 * "what just happened" without each module having to re-implement
 * console formatting.
 *
 * Sinks:
 *   - `console.debug` (always, when available)
 *   - in-memory ring buffer of the last `RING_SIZE` events (read via
 *     `getRecentEvents()`).
 *
 * Zero deps; safe to call from any environment (Node script, browser,
 * SSR worker).
 */

export type TelemetryEventKind =
  | 'parser.chunk_start'
  | 'parser.chunk_done'
  | 'parser.polish'
  | 'parser.error'
  | 'agent.created'
  | 'agent.enriched'
  | 'context.built'
  | 'dialogue.responders_selected'
  | 'dialogue.completed'
  | 'state.delta_applied'
  | 'reflection.generated'
  | 'deep.interaction'
  | 'llm.latency';

export interface TelemetryEvent {
  kind: TelemetryEventKind;
  ts: number;
  /** Free-form payload — kept JSON-serializable for the future panel. */
  payload?: Record<string, unknown>;
}

const RING_SIZE = 200;
const ring: TelemetryEvent[] = [];

export function logEvent(
  kind: TelemetryEventKind,
  payload?: Record<string, unknown>,
): void {
  const ev: TelemetryEvent = { kind, ts: Date.now(), payload };
  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();
  if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[tt:${kind}]`, payload || '');
  }
}

/**
 * Returns a shallow copy of the last `n` events (defaults to all).
 * Newest last.
 */
export function getRecentEvents(n?: number): TelemetryEvent[] {
  if (typeof n === 'number') return ring.slice(-n);
  return [...ring];
}

