# narration_protocol

Owns: parsing the model's response from the「:::指令行」narration protocol into
narration / dialogues / choices / interactions — both incrementally (for live
streaming) and at completion.

## Why

The old contract asked the model for a JSON object embedded in prose. Three
problems made it a poor fit for a streaming, browser-only interactive novel:

1. **Latency to first paint.** A JSON string can't be shown until its closing
   quote arrives — the reader stares at nothing while a long narration buffers.
2. **All-or-nothing fragility.** One malformed comma or unescaped quote breaks
   the *whole* object; the entire turn is lost.
3. **Token waste.** Every quote and newline inside the prose has to be escaped,
   inflating output and giving the model more chances to slip.

The directive-line protocol fixes all three: each instruction is its own line
and never nested, so **text on screen the instant it arrives**, **a broken line
costs only that line**, and **body text needs no escaping**.

The authoritative grammar lives in the「## 交互格式要求」section of
`src/lib/prompts/dialogue-runtime.ts` (written by the supervising prompt
author). This parser must stay character-for-character compatible with it; the
prompt's grammar and the parser's grammar must never drift apart.

## Grammar

```
:::narration              open a narration segment; following lines are body,
                          until the next directive. May appear multiple times;
                          segments are joined in order with "\n".
:::say 角色名             open a dialogue segment for that speaker; speaker =
                          all text after ":::say", trimmed. Following lines are
                          the dialogue body.
:::choice 选项文本        single line: a normal choice.
:::choice! 选项文本       single line: a branch-point choice (isBranchPoint=true).
                          The "!" is glued to the directive name.
:::interact 角色名 | positive|neutral|negative | 事件简述 | 角色对玩家的反应
                          single line, "|"-separated, trimmed.
:::end                    optional terminator; closes the open segment.
```

## Parsing rules

1. `stripThinking` first (reuses the implementation in `../llm-text`, also
   re-exported by `narrator-browser`) to remove `<think>` blocks.
2. Scan line by line. A line whose trimmed form starts with `:::` is a directive
   line. The directive name is the first token after `:::`, case-insensitive;
   `choice!`'s `!` is glued to the name. Other lines are body for the currently
   open segment (narration / say).
3. An unknown directive line is ignored whole (forward compatibility). A body
   line with no open segment is folded into narration (tolerates a model that
   forgot the header).
4. `interact` is split on `|` and trimmed; missing fields default to empty; an
   illegal/missing sentiment is normalized to `neutral`.
5. Streaming increment: the last unfinished line (buffer not ending in `\n`) is
   shown immediately when the open segment is narration/say (the protocol's core
   advantage) — but is **held back** if it starts with `:` (it may be forming a
   directive).
6. Detection: `isProtocolResponse(cleaned)` is true when any line matches
   `/^\s*:::(narration|say)\b/im`. On a hit the protocol parser runs; otherwise
   the caller falls back to the legacy JSON three-tier rescue in
   `narrator-browser`.

## API

```ts
isProtocolResponse(cleaned: string): boolean
extractProtocolStreamingState(buffer: string): StreamingState   // includes a partial trailing dialogue
parseProtocolFinal(buffer: string): {
  narration: string;
  dialogues: { speaker: string; content: string }[];
  choices: { text: string; isBranchPoint: boolean }[];
  interactions: { characterName: string; event: string; reaction: string; sentiment: string }[];
}
```

`StreamingState` / `StreamingDialogue` and `stripThinking` are imported from
`../llm-text` (re-exported by `narrator-browser`) so the streaming shape matches
the legacy path exactly.
Both functions share a single line-scanner (`scan`) so the streaming and final
views can never diverge.

All functions are pure and free of browser APIs, so they can be unit-tested
directly under node.
```
