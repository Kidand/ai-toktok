/**
 * Agent persona prompts.
 *
 * Two roles:
 *   1. Reincarnation generator — produces a brand-new player character that
 *      fits an existing world bible (used when the player picks "transmigrate"
 *      mode in setup).
 *   2. Agent profile generator (Phase 3) — converts a WorldEntity of type
 *      "character" into a runtime AgentProfile (goal/fear/secret/behaviorRules).
 *      Phase 0 only stages the prompt; the wiring lands in Phase 3.
 */

import type { ParsedStory } from '../types';

export const REINCARNATION_SYSTEM_PROMPT = `根据以下世界观，生成一个符合背景的全新原创角色。返回严格JSON：
{
  "name": "角色名",
  "description": "外貌及身份简述",
  "personality": "性格特征",
  "background": "背景故事",
  "relationships": [
    {
      "targetName": "已有角色名（必须是输入里出现过的角色名）",
      "relation": "一句话关系描述（如：青梅竹马 / 宿敌 / 同一阵营的下属）",
      "polarity": -1 到 1 的浮点数（-1=敌对，0=中立，1=亲密；取一位小数）,
      "strength": 0 到 1 的浮点数（0=极淡，1=命运纠缠级；取一位小数）
    }
  ]
}

要求：
- relationships 至少 2 条，最多 5 条；只能与"已有角色"列表里的角色建立关系
- 关系要紧扣世界观和该角色的背景故事，避免空泛
- 不要与所有角色都建立关系——选与背景最契合的几位即可
- 不输出 JSON 以外的任何文字`;

export function buildReincarnationUserMessage(story: ParsedStory): string {
  return `世界：${story.title}\n时代：${story.worldSetting.era}\n类型：${story.worldSetting.genre}\n设定：${story.worldSetting.rules.join('；')}\n已有角色：${story.characters.map(c => c.name).join('、')}`;
}

/**
 * Phase 3 will use this to produce AgentProfile records. Kept here so the
 * shape stays alongside the rest of the agent-related prompts.
 */
export const AGENT_PERSONA_SYSTEM_PROMPT = `你收到一个世界 IP 中的角色资料，需要把它扩展成一个可在互动叙事里被驱动的 NPC AgentProfile。

## 输出 JSON
{
  "name": "角色名（与输入一致）",
  "persona": "一句话角色定位（80字内）",
  "speechStyle": "说话风格描述（特定词癖、语速、习惯）",
  "goals": ["短期目标1", "长期目标2"],
  "fears": ["最害怕的事1", "深层焦虑2"],
  "secrets": ["不愿被人知道的事1（可空数组）"],
  "relationshipMap": [
    { "targetName": "其他角色名", "feeling": "情感关键词", "history": "一句话过往" }
  ],
  "behaviorRules": [
    "当 X 发生时，他会 Y（具体可执行）",
    "对 Z 类型的请求，他不会答应"
  ]
}

## 要求
- 保留原作矛盾，不要把角色写成单一标签
- behaviorRules 必须能在对话期被运行时引用，写成"当...就..."句式
- 不输出 JSON 以外的任何文字`;
