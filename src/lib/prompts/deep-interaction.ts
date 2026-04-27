/**
 * Deep-interaction prompts. None of these advance the main story; they
 * answer the player's meta questions or run sandboxed what-ifs.
 *
 * Each prompt is short and tightly scoped. The runtime appends the same
 * recent-history context block so answers are grounded in the actual
 * playthrough.
 */

import type {
  AgentProfile, NarrativeEntry, ParsedStory, PlayerConfig,
} from '../types';

export const AGENT_INTERVIEW_SYSTEM = (agentName: string) => `你是 ${agentName} 在故事之外、被作者请来接受访谈。访谈不会影响主线剧情。

## 规则
- 用 ${agentName} 自己的口吻、词癖、价值观回答（参考下方 persona 和 speechStyle）。
- 严禁透露 ${agentName} 在原故事中根本不可能知道的信息（剧情未来 / 玩家在其他角色那里说过的话）。
- 直接说话，不要 JSON、不要旁白标签，回答控制在 200 字以内。
- 玩家可能问内心想法、对某个事件的看法、对某个角色的评价；都可以诚实但符合人设地回答。`;

export const WORLD_QA_SYSTEM = `你是世界 IP 的"设定考据员"。回答关于世界规则、阵营、地理、术语等设定层问题。

## 规则
- 仅基于下方提供的 worldSetting / loreEntries / factions 中的明文。如果资料里没有，请直说"未记载"。
- 不要展开情节，不要泄漏剧情走向。
- 用平静、客观的口吻；250 字以内；可以分小标题，但不要 JSON。`;

export const IF_ELSE_SANDBOX_SYSTEM = `你是互动叙事的"if-else 沙盒"。玩家提出一个假设："如果当时我做了 X 而不是 Y，会怎样？" 你要在不写入主线的前提下，用最多 250 字给出一个**可能的**剧情演化结果。

## 规则
- 必须以 "假设：……" 开头，强调这是平行可能而非主线。
- 演化要符合下方角色的 persona 与已知冲突。
- 不要 JSON。结尾用一句"主线未变"提醒玩家。`;

export const RELATIONSHIP_EXPLAINER_SYSTEM = `你是"关系变化解说员"。玩家想知道为什么和某个角色的关系发生了变化。

## 规则
- 必须基于下方提供的最近事件 / 对话 / StateDelta 证据。
- 用最多 180 字、平静口吻，引用至少一个具体事件。
- 不要 JSON、不要承诺未来。`;

export interface DeepInteractionContextInput {
  story: ParsedStory;
  playerConfig: PlayerConfig;
  history: NarrativeEntry[];
  /** AgentProfile of the focus agent for AGENT_INTERVIEW_SYSTEM. */
  agent?: AgentProfile;
  /** Override the recent-history window. Default 6 entries. */
  windowSize?: number;
}

/**
 * Shared context block appended to every deep-interaction prompt. Keeps
 * the answers grounded in the player's actual playthrough.
 */
export function buildDeepInteractionContext(input: DeepInteractionContextInput): string {
  const { story, playerConfig, history, agent, windowSize = 6 } = input;
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;

  const recent = history.slice(-windowSize).map(e => {
    switch (e.type) {
      case 'narration': return `[叙事] ${e.content}`;
      case 'dialogue': return `[${e.speaker}] ${e.content}`;
      case 'player-action': return `[玩家] ${e.content}`;
      default: return e.content;
    }
  }).join('\n');

  const agentBlock = agent ? `

## 受访者 (${agent.name})
persona: ${agent.persona}
speechStyle: ${agent.speechStyle || '（未设）'}
goals: ${(agent.goals || []).join('；') || '（未设）'}
fears: ${(agent.fears || []).join('；') || '（未设）'}
secrets: ${(agent.secrets || []).join('；') || '（未设）'}` : '';

  const factionsBlock = story.factions && story.factions.length > 0
    ? `\n\n## 阵营\n${story.factions.map(f => `- ${f.name}：${f.description || ''}${f.ideology ? `（${f.ideology}）` : ''}`).join('\n')}`
    : '';

  const loreBlock = story.loreEntries && story.loreEntries.length > 0
    ? `\n\n## 关键设定\n${story.loreEntries.slice(0, 10).map(l => `- ${l.title}: ${l.content}`).join('\n')}`
    : '';

  return `## 故事
${story.title} · ${story.worldSetting.era} · ${story.worldSetting.genre}

## 玩家
${playerChar?.name || '旅人'}（${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}）${agentBlock}${factionsBlock}${loreBlock}

## 最近的剧情
${recent || '（故事刚开始）'}`;
}
