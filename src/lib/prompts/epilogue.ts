/**
 * Epilogue (after-story) prompts. The output is a JSON array of memoirs, one
 * per character who actually interacted with the player. The streamer in
 * narrator-browser surfaces each memoir as it completes, so don't change the
 * "[{characterName, memoir}]" shape without also touching extractStreamingEpilogue.
 */

import type { ParsedStory, PlayerConfig } from '../types';

export const EPILOGUE_SYSTEM_PROMPT = `你是互动叙事的"后日谈生成器"。玩家刚刚完成了一次**独一无二的游玩经历**，你需要让每个与玩家有过交集的角色，以第一人称写一段对玩家的回忆。

## 核心原则（非常重要）
1. **严禁复述原作剧情**。这次游玩里发生的所有事件，哪怕与原作同名，也应以**本次游玩中真实呈现的细节**为准。不要写"据说发生过"、"在那个故事里"这类模糊说法。
2. **必须直接引用本次游玩中的具体片段**：具体的对话原话、玩家做过的具体动作、事件发生的具体场景。每个回忆里至少出现 **2-3 个**可以对应到下方叙事记录的具体细节。
3. **用角色自己的声音写**：参考每个角色的性格（personality）和背景（background），让 diction、用词习惯、情感偏好符合这个角色。不同角色的回忆要有明显的语气差异。
4. **情感轨迹必须体现**：如果某个角色与玩家的互动记录显示了明显的情感变化（比如从中立到好感、或从好感到嫌隙），这个转变必须在回忆里被写出来，并指出是哪个具体事件造成的。
5. 第一人称叙述，每段 **200-400 字**。可以包含评价、遗憾、感激、困惑、怅惘等情感，不要只陈述事件。

## 输出格式（必须严格遵守，否则下游解析会错配角色与回忆）
- 顶层是 JSON 数组，**按下方"需要写回忆的角色"列出的顺序**输出，不能调换顺序、不能跳过、不能合并。
- 每个对象必须**先写 \`characterName\`，再写 \`memoir\`**：键的顺序固定为 \`{"characterName": "...", "memoir": "..."}\`。
- \`characterName\` 必须**逐字精确**复制下方列表里给出的角色名（包括标点、空格、姓氏完整形式），不要用别名、爱称或省略写法。
- **完成当前对象（包含闭合花括号）之后**才开始下一个角色；**禁止**先写多个对象的开头再回头补内容。
- 不要在数组前后输出任何文字、标题、注释或 \`\`\`json 围栏。
- 整段返回应该恰好是：
  [
    { "characterName": "角色甲", "memoir": "..." },
    { "characterName": "角色乙", "memoir": "..." }
  ]`;

export interface EpilogueUserMessageInput {
  story: ParsedStory;
  playerConfig: PlayerConfig;
  playerName: string;
  characterSections: string;
  transcript: string;
  participantCount: number;
  /** Authoritative ordered list of names. Repeated separately so the model
   *  can sanity-check its output against a clean, unadorned roster. */
  participantNames: string[];
}

export function buildEpilogueUserMessage({
  story, playerConfig, playerName, characterSections, transcript,
  participantCount, participantNames,
}: EpilogueUserMessageInput): string {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;

  const numberedRoster = participantNames
    .map((n, i) => `  ${i + 1}. "${n}"`)
    .join('\n');

  return `## 故事世界
${story.title} · ${story.worldSetting.era} · ${story.worldSetting.genre}

## 玩家
名字：${playerName}
进入方式：${playerConfig.entryMode === 'soul-transfer' ? '魂穿（扮演既有角色）' : '转生（全新原创角色）'}
身份：${playerChar?.description || '（无）'}
性格：${playerChar?.personality || '（无）'}

## 需要写回忆的角色（共 ${participantCount} 位，请严格按此顺序、按此姓名输出）
${characterSections}

## 输出顺序与姓名核对清单（characterName 必须逐字命中以下任一字符串）
${numberedRoster}

## 本次游玩的完整叙事记录
${transcript}

请基于上面这次独有的游玩记录，为每位角色写一段第一人称的回忆。
**自检**：在你写下每个对象的 \`characterName\` 字段时，确认它与上方"姓名核对清单"中下一个未使用的条目逐字相符。`;
}
