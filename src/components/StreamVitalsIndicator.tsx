import type { StreamVitals } from '@/lib/stream_harness';

export function StreamVitalsIndicator({
  vitals,
  busyLabel = '正在思考',
  onCancel,
}: {
  vitals: StreamVitals | null;
  busyLabel?: string;
  onCancel?: () => void;
}): React.ReactNode | null {
  if (vitals === null) return null;

  const elapsedSec = Math.floor(vitals.elapsedMs / 1000);
  const stalledSec = Math.floor(vitals.sinceActivityMs / 1000);

  if (vitals.phase === 'connecting') {
    return (
      <div className="system-line">
        ▸ 正在连接…
      </div>
    );
  }

  if (vitals.phase === 'thinking') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* typing-cursor 的 ::after 伪元素会自动追加闪烁光标 */}
          <span className="typing-cursor font-mono text-[0.8rem] font-bold tracking-wide text-[var(--ink)]">
            ✦ {busyLabel} · {elapsedSec}s
          </span>
          {vitals.thinkingTicks > 0 && (
            <span className="chip chip-teal">
              reasoning · {vitals.thinkingTicks}
            </span>
          )}
        </div>
        {vitals.elapsedMs > 15000 && (
          <p className="font-mono text-[11px] text-[var(--ink-muted)]">
            推理模型思考阶段不输出文字，计数在涨说明连接是活的
          </p>
        )}
      </div>
    );
  }

  if (vitals.phase === 'writing') {
    return (
      <div className="font-mono text-[0.8rem] font-bold tracking-wide text-[var(--ink-muted)]">
        ✎ {busyLabel} · {elapsedSec}s
      </div>
    );
  }

  // phase === 'stalled'
  return (
    <div className="surface p-3" style={{ boxShadow: '3px 3px 0 var(--hi-coral)' }}>
      <div className="flex items-start gap-3 flex-wrap">
        <p className="font-mono text-xs flex-1 min-w-0">
          ⚠ 已 {stalledSec}s 没有响应，可能是网络或服务卡住
        </p>
        {onCancel && (
          <button
            type="button"
            className="btn btn-outline btn-sm shrink-0"
            onClick={onCancel}
          >
            取消本轮
          </button>
        )}
      </div>
    </div>
  );
}
