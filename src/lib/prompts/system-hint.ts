/**
 * "@system" out-of-character hint prompt. Distinct from the narrator prompt:
 *   - the answer is plain prose, not JSON
 *   - hard cap at 120 chars to feel like a whisper
 *   - explicit no-spoiler rules so the OOC channel can't be used to game the
 *     story
 */

import type { ParsedStory, PlayerConfig, NarrativeEntry } from '../types';

export function buildSystemHintPrompt(
  story: ParsedStory,
  playerConfig: PlayerConfig,
  history: NarrativeEntry[],
): string {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;

  const recentContext = history.slice(-6).map(entry => {
    switch (entry.type) {
      case 'narration': return `[叙事] ${entry.content}`;
      case 'dialogue': return `[${entry.speaker}] ${entry.content}`;
      case 'player-action': return `[玩家] ${entry.content}`;
      default: return entry.content;
    }
  }).join('\n\n');

  return `你是互动叙事引擎的"系统顾问"，为玩家提供简短的游戏提示。

## 规则
- 你的回答对剧情透明，不计入对话历史。
- 回答必须简短（不超过 120 字），直接实用，像一个"小声耳语"。
- **严禁剧透**：不暴露未来的事件走向、角色秘密、未揭示的真相。
- 可以做的事：
  - 提醒玩家当前的场景元素（有哪些人可以交互、有哪些可见的选项）
  - 解释世界观规则的含义
  - 给出与剧情目标相关的建议方向（但不指定具体动作）
  - 澄清玩家之前对话中可能没理解的细节
- 不要用 JSON 或任何结构化格式，直接用自然语言回答。

## 故事背景
${story.title} · ${story.worldSetting.era} · ${story.worldSetting.genre}

## 玩家
${playerChar?.name || '旅人'}（${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}）

## 最近的剧情
${recentContext || '（故事刚开始）'}
`;
}
