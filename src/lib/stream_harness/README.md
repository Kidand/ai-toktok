# stream_harness

Owns: the streaming "vitals" layer — exposing *metadata* about an in-flight LLM
generation (heartbeat counts, elapsed time, phase) without ever surfacing the
reasoning text itself.

## Why

Reasoning models (DeepSeek-R1 and friends) can think silently for 30-90s before
emitting a single character of prose. With nothing on screen the user assumes
the app has hung. We cannot show the thinking either: it leaks private chain-of-
thought and spoils the story. So `createVitalsTracker` watches the stream and
reports only how *alive* it is — never *what* it is thinking.

## Phase machine

Derived on every update, mutually exclusive:

- `connecting` — no byte or activity seen yet (still reaching the server).
- `thinking` — work is happening but there is *nothing to show*: covers the
  reasoning channel, inline `<think>` blocks, and the JSON preamble. (Activity
  within `stallAfterMs`, but visible content has not grown in the last 2s.)
- `writing` — visible content grew within the last 2s.
- `stalled` — zero activity on any channel for `stallAfterMs` (default 20s);
  likely a real hang, so the UI can offer a cancel affordance.

A built-in 1s heartbeat keeps `elapsedMs` / `sinceActivityMs` advancing even at
zero tokens — that is what keeps the indicator visibly alive instead of relying
on network byte timing.

## Privacy constraint

The reasoning *text* never leaves the `llm-browser` layer. The harness is fed
only signals: `noteThinking()` (a reasoning heartbeat), `noteRaw()` (bytes
arrived but aren't visible yet), `noteVisible(totalChars)` (cumulative visible
length). It counts ticks and characters — it never holds the content.

`StreamVitalsIndicator` renders the resulting `StreamVitals`.
