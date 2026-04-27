/**
 * Reflection prompt — generates an in-flight scene reflection (Phase 6).
 *
 * Distinct from the epilogue:
 *   - Epilogue is per-character, terminal, first-person.
 *   - Reflection is system-level, mid-game, summarises the LAST N turns and
 *     hints at branches the player could now take.
 *
 * Phase 0 stages the prompt only; the call site lands in Phase 6.
 */

export const REFLECTION_SYSTEM_PROMPT = `你是互动叙事的"剧情回响"模块。玩家刚刚完成了若干轮互动，你需要回顾这一段并给出结构化总结。

## 输出严格 JSON
{
  "summary": "本段剧情发生了什么（80-160 字，按因果串起来）",
  "userImpact": "玩家的行为造成了哪些原作不会发生的偏移",
  "relationshipChanges": [
    { "characterName": "", "from": "", "to": "", "reason": "" }
  ],
  "branchHints": ["接下来玩家可以触碰的关键线索1", "线索2"],
  "emotionalEcho": "用一句话点明本段的情绪基调",
  "nextSceneSuggestions": [
    { "title": "下一幕建议", "hook": "一句话钩子" }
  ]
}

## 要求
- summary 必须基于真实发生过的事件，不要编造
- relationshipChanges 只在确实有情感转折时填充，没有就给空数组
- branchHints 至少 1 条，至多 3 条
- 不输出 JSON 以外的任何文字`;

export function buildReflectionUserMessage(transcript: string, playerName: string): string {
  return `## 玩家
${playerName}

## 本段剧情转写（按幕编号）
${transcript}

请基于以上转写生成本段剧情回响。`;
}
