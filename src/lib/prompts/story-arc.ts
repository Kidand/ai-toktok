/**
 * Story-arc prompt — generates the four-phase 起 / 承 / 转 / 合 recap
 * shown at the top of the epilogue page.
 *
 * Distinct from the per-character memoirs:
 *   - This is system-level, third-person, factual.
 *   - It references the *playthrough* not the source IP.
 *   - It explicitly flags "what the player did / changed / who shifted
 *     because of them" — this is the emotional payoff sentence the
 *     epilogue page leans on.
 */

import type { StoryArcStats } from '../types/index';

export const STORY_ARC_SYSTEM_PROMPT = `你是互动叙事的"故事弧总结员"。玩家刚刚结束了一段独有的游玩，你需要把它压缩成四段式回顾："起 / 承 / 转 / 合"。

## 写作原则
1. **主语必须是玩家**。每一段都要点出"玩家做了什么 / 改变了什么 / 谁因此而变化"。
2. **只引用本次游玩中真实出现过的事件**，不要复述原作设定，不要说"据传"、"在原故事中"。
3. 四段总字数 200-400 字，**起 / 承 / 转 / 合** 每段约 50-100 字，长度大致均衡。
4. 第三人称叙述（避免用"我"），文学性可以稍强但不要矫情。
5. **必须出现至少 2 个角色名**，至少 1 个具体地点或场景，至少 1 个明确的玩家动作。

## 四段定义
- **起**：玩家以何种身份进入故事，最初的处境。
- **承**：玩家最初的几次行动如何让事态发酵。
- **转**：本次游玩出现的关键转折点 —— 因玩家的某个具体决定而出现的偏离。
- **合**：故事如何收束，谁的关系/状态因玩家而最终发生了变化。

## 输出格式
严格 JSON，键顺序固定。不要 \`\`\`json 围栏，不要任何前后文：
{
  "qi": "起阶段的概述（约 50-100 字）",
  "cheng": "承阶段的概述（约 50-100 字）",
  "zhuan": "转阶段的概述（约 50-100 字）",
  "he": "合阶段的概述（约 50-100 字）"
}`;

export interface StoryArcUserMessageInput {
  playerName: string;
  storyTitle: string;
  storyGenre: string;
  storyEra: string;
  transcript: string;
  stats: StoryArcStats;
  /** Names of characters who had non-neutral interactions, comma-joined. */
  shiftedRelationships?: string[];
}

export function buildStoryArcUserMessage({
  playerName, storyTitle, storyGenre, storyEra,
  transcript, stats, shiftedRelationships,
}: StoryArcUserMessageInput): string {
  const shifted = shiftedRelationships && shiftedRelationships.length > 0
    ? `\n\n## 关系发生变化的角色\n${shiftedRelationships.join('、')}`
    : '';
  return `## 故事
${storyTitle} · ${storyEra} · ${storyGenre}

## 玩家
${playerName}

## 关键统计（仅供参考，不必逐项搬到正文）
- 总互动轮数: ${stats.totalTurns}
- 到访场景数: ${stats.locationsVisited}
- 对话角色数: ${stats.dialogueCharacters}
- 群体事件数: ${stats.groupSceneCount}
- 关系变动次数: ${stats.relationshipShifts}${shifted}

## 完整叙事记录
${transcript}

请输出"起 / 承 / 转 / 合"四段式 JSON 总结。`;
}
