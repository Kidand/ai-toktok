/**
 * stream_harness — 流式生成的「生命体征（vitals）」追踪层。
 *
 * 设计动机：推理模型（DeepSeek-R1 等）在吐出正文前可能静默思考 30-90 秒。
 * 用户看不到任何动静，会误以为程序卡死；而思考正文本身既涉隐私又会剧透，
 * 绝不能展示。本模块的取舍是：只暴露思考的「元数据」（心跳计数、耗时、相位），
 * 思考正文永远停留在 llm-browser 层，harness 只见心跳。
 *
 * 四相位语义（每次更新即时推导，互斥）：
 *  - connecting：尚未见到任何字节/活动——还在连服务端。
 *  - thinking：在干活但「没东西可看」——覆盖 reasoning 通道、内联 <think>、
 *      JSON 前导三种情况（有活动但可见内容近 2s 没增长）。
 *  - writing：可见内容正在增长（最近 2s 内涨过）。
 *  - stalled：超 stallAfterMs 任何通道零活动——疑似真卡死，UI 可给取消入口。
 *
 * 关键取舍：内置 1s 心跳即使零 token 也照常发出 onUpdate，使
 * elapsedMs / sinceActivityMs 持续走动——「界面永远活着」靠这个保证，
 * 而非依赖网络字节的到达节奏。
 *
 * 纯浏览器 lib 层，无 React 依赖。
 */

export type StreamPhase = 'connecting' | 'thinking' | 'writing' | 'stalled';

export interface StreamVitals {
  phase: StreamPhase;
  /** ms since the tracker started */
  elapsedMs: number;
  /** reasoning heartbeats seen so far — the reasoning TEXT itself is never exposed */
  thinkingTicks: number;
  /** user-visible characters extracted so far */
  visibleChars: number;
  /** ms since the last sign of life on any channel */
  sinceActivityMs: number;
}

export interface VitalsTracker {
  noteThinking(): void; // reasoning 通道心跳
  noteRaw(): void; // 收到原始字节但（暂）不可见（JSON 前导/内联 think）
  noteVisible(totalChars: number): void; // 可见内容累计长度
  dispose(): void; // 清理定时器，停止一切回调
}

/** 可见内容须在最近这个窗口内增长过，才算处于 writing 相位。 */
const WRITING_WINDOW_MS = 2000;

export function createVitalsTracker(opts: {
  onUpdate: (v: StreamVitals) => void;
  stallAfterMs?: number; // 默认 20000
  throttleMs?: number; // 默认 250；相位变化时绕过节流立即回调
}): VitalsTracker {
  const stallAfterMs = opts.stallAfterMs ?? 20000;
  const throttleMs = opts.throttleMs ?? 250;

  const startedAt = Date.now();
  let lastActivityAt = startedAt; // 任意通道的最近活动时间
  let lastVisibleGrowthAt = 0; // 可见内容最近一次增长的时间（0 = 从未）
  let sawAnyActivity = false; // 是否见过任何字节/心跳

  let thinkingTicks = 0;
  let visibleChars = 0;

  let lastEmitAt = 0;
  let lastPhase: StreamPhase | null = null;
  let disposed = false;

  function derivePhase(now: number): StreamPhase {
    if (!sawAnyActivity) return 'connecting';
    const sinceActivity = now - lastActivityAt;
    // 可见内容在最近 2s 内涨过 → 正在书写
    if (lastVisibleGrowthAt > 0 && now - lastVisibleGrowthAt <= WRITING_WINDOW_MS) {
      return 'writing';
    }
    // 超时零活动 → 疑似卡死
    if (sinceActivity > stallAfterMs) return 'stalled';
    // 有活动但没东西可看 → 仍在构思
    return 'thinking';
  }

  // 统一的回调闸门：节流 + 相位变化即时放行。
  function maybeEmit(now: number): void {
    if (disposed) return;
    const phase = derivePhase(now);
    const phaseChanged = phase !== lastPhase;
    if (!phaseChanged && now - lastEmitAt < throttleMs) return;

    lastEmitAt = now;
    lastPhase = phase;
    opts.onUpdate({
      phase,
      elapsedMs: now - startedAt,
      thinkingTicks,
      visibleChars,
      sinceActivityMs: now - lastActivityAt,
    });
  }

  // 内置 1s 心跳：即使零 token，也让 elapsedMs/sinceActivityMs 走动（受节流约束）。
  const heartbeat = setInterval(() => {
    if (disposed) return;
    maybeEmit(Date.now());
  }, 1000);

  return {
    noteThinking() {
      if (disposed) return;
      const now = Date.now();
      thinkingTicks += 1;
      sawAnyActivity = true;
      lastActivityAt = now;
      maybeEmit(now);
    },
    noteRaw() {
      if (disposed) return;
      const now = Date.now();
      sawAnyActivity = true;
      lastActivityAt = now;
      maybeEmit(now);
    },
    noteVisible(totalChars: number) {
      if (disposed) return;
      const now = Date.now();
      sawAnyActivity = true;
      lastActivityAt = now;
      if (totalChars > visibleChars) {
        visibleChars = totalChars;
        lastVisibleGrowthAt = now;
      }
      maybeEmit(now);
    },
    dispose() {
      disposed = true; // 置位后所有 note*/maybeEmit/心跳都不再回调
      clearInterval(heartbeat);
    },
  };
}
