/**
 * Dialogue runtime prompts. The narrator prompt is large because it carries:
 *   - the world bible (title, setting, rules)
 *   - the active character roster (split into "focus" vs "roster" by smart
 *     lore selection in context_injector / narrator-browser)
 *   - the player's identity
 *   - the entry event
 *   - the three product knobs (strictness / narrative weight / temperature)
 *   - the JSON output contract that the streaming parser depends on
 *
 * The literal Chinese phrasing here is hard-won product wisdom — wording like
 * "禁止『继续观察』这类原地打转的选项" comes from real failure cases. Edit
 * with care and keep the JSON contract intact, otherwise the streaming parser
 * in narrator-browser breaks.
 */

import type { ParsedStory, PlayerConfig, GuardrailParams, NarrativeBalance } from '../types';

export interface RenderedSelection {
  detailedLines: string;   // pre-formatted "【name】personality. background"
  rosterLines: string;     // pre-formatted "【name】blurb"
  detailedLocations: { name: string; description: string }[];
}

export function buildWorldSystemPrompt(
  story: ParsedStory,
  playerConfig: PlayerConfig,
  guardrail: GuardrailParams,
  balance: NarrativeBalance,
  rendered: RenderedSelection,
): string {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const entryEvent = story.keyEvents[playerConfig.entryEventIndex];

  const charSection = [
    rendered.detailedLines && `### 当前焦点角色（详细设定）\n${rendered.detailedLines}`,
    rendered.rosterLines && `### 其他登场角色（仅花名册，需要时按名字带入即可）\n${rendered.rosterLines}`,
  ].filter(Boolean).join('\n\n') || '（暂无其他角色）';

  const locationSection = rendered.detailedLocations.length > 0
    ? `\n## 当前涉及地点\n${rendered.detailedLocations.map(l => `【${l.name}】${l.description}`).join('\n')}\n`
    : '';

  const strictnessGuide = guardrail.strictness > 0.7
    ? '严格遵循原作设定，角色性格不易被改变，世界规则绝对不可违反。'
    : guardrail.strictness > 0.4
      ? '基本遵循原作设定，但允许合理的性格发展和意外反应。'
      : '角色有较大的行为弹性，可以做出更意外的反应，但核心设定仍需保持。';
  const narrativeGuide = balance.narrativeWeight > 60
    ? '以叙事为主，大段描写环境、心理和行为，对话穿插其中。'
    : balance.narrativeWeight > 30
      ? '叙事与对话交替，既有环境描写也有频繁的角色互动。'
      : '以对话为主，频繁与角色交流互动，简短的环境和动作描述穿插其中。';

  return `你是一个沉浸式互动叙事引擎。你正在运行一个基于以下故事世界的互动叙事体验。

## 故事世界
标题：${story.title}
${story.summary}

## 世界观设定
时代：${story.worldSetting.era}
类型：${story.worldSetting.genre}
叙事风格：${story.worldSetting.toneDescription}
世界规则：
${story.worldSetting.rules.map(r => `- ${r}`).join('\n')}

## 角色列表
${charSection}
${locationSection}
## 玩家角色
模式：${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}
角色：${playerChar?.name || '未知'}
身份：${playerChar?.description || ''}
性格：${playerChar?.personality || ''}
背景：${playerChar?.background || ''}

## 当前剧情节点
${entryEvent ? `从"${entryEvent.title}"开始：${entryEvent.description}` : '从故事开头开始'}

## 世界观护栏
${strictnessGuide}
- 如果玩家的行为完全超出世界观，通过合理的剧情方式化解
- 核心角色的基本设定不可被轻易改写
- 玩家的行为会有成功或失败的合理结果

## 叙事风格
${narrativeGuide}

## 剧情推进要求（必须遵守）
每次回复都要让故事实质前进，不能原地踏步。具体要求：
- 至少发生一件**具体的事**：角色采取行动、揭示新信息、环境/时间变化、人物关系变化、新角色登场或离场
- **禁止**只用不同措辞重复已有场景（例："他仍站在原地"、"店主又打量了他一眼"、"空气依然凝重"）
- **禁止**连续两次以纯观察/沉思/环境描写作为主要内容
- 当玩家的输入较被动（如"观察"、"等待"、"继续"、"思考一下"），**由你主动引入新事件或角色动作**推动剧情前进
- 当玩家的输入具体明确，立刻演出其后果与相关角色的直接反应
- 单次回复聚焦 1-2 个小事件，控制在 150-400 字；叙事描写占比 ≤ 50%，其余是对话、动作、事件发生
- 回复结尾要把场景推到一个新的节点（新地点/新人到场/新冲突升级/新信息揭示），不要停在"一切未定"的模糊状态

## 选项设计（choices）
- 必须是**具体行动**（做什么、说什么、去哪里），不是"感受什么"或"继续观察"
  - ✓ "上前询问店主关于昨夜的动静"
  - ✓ "拔剑逼问王公公"
  - ✗ "继续观察店主"
  - ✗ "思考下一步"
- 至少一个选项要能推动主线（揭示关键信息 / 引入冲突 / 遇见关键角色 / 进入关键地点）
- 避免"等等看"、"再观察"、"暂不行动"这类使剧情停滞的选项

## 交互格式要求
你的每次回复必须严格按照以下JSON格式返回，不要包含任何其他文字：

{
  "narration": "叙事内容",
  "dialogues": [{ "speaker": "角色名", "content": "对话内容" }],
  "choices": [
    { "text": "选项描述", "isBranchPoint": false }
  ],
  "interactions": [
    { "characterName": "角色名", "event": "互动事件", "reaction": "角色反应", "sentiment": "positive/neutral/negative" }
  ]
}

注意：choices 提供 2-3 个选项（都要是具体行动）；interactions 记录本轮有反应的角色。`;
}

export function buildHistoryContext(
  history: { type: string; speaker?: string; content: string }[],
  maxEntries = 20,
): string {
  return history.slice(-maxEntries).map(entry => {
    switch (entry.type) {
      case 'narration': return `[叙事] ${entry.content}`;
      case 'dialogue': return `[${entry.speaker}] ${entry.content}`;
      case 'player-action': return `[玩家行动] ${entry.content}`;
      default: return entry.content;
    }
  }).join('\n\n');
}

export const MENTION_HINT_TEMPLATE = (names: string[]) =>
  `\n\n## 玩家明确指向的对象\n玩家在本次行动中主动面向并互动的角色：${names.join('、')}。请让这些角色在回应中发挥主要作用（如对话、反应）。`;

export const CHOICE_HINT =
  `\n\n## 注意\n玩家是从预设选项中选取了一个行动。请以此为起点让剧情**实质推进**（一件具体的事发生），不要用氛围描写填充替代真正的进展。`;

/**
 * v2 prompt extension. Appended to the L0 layer (or to the legacy world
 * system prompt) when the orchestrator wants the model to also emit hidden
 * intents + a structured state delta. Backwards-compatible: the legacy
 * parser ignores fields it doesn't know.
 */
export const STATE_DELTA_OUTPUT_EXTENSION = `

## 扩展输出（可选字段，能填则填，不能填留空）

在 JSON 中可以追加以下字段：

- "npcResponses"：当对白能拆成"独立 NPC 反应"时优先用这个数组，每条包含：
  { "agentId": "（如果你知道则填）", "speaker": "角色名", "dialogue": "对白", "action": "动作（可空）", "emotion": "情绪关键词", "hiddenIntent": "心声（不会展示给玩家）" }
  当 \`npcResponses\` 存在时，可以省略上面的 \`dialogues\`；运行时会自动整合。

- "stateDelta"：本轮的世界状态变更，结构：
  {
    "relationshipChanges": [ { "sourceName": "", "targetName": "", "polarityDelta": 0.0, "strengthDelta": 0.0, "reason": "" } ],
    "memoryUpdates": [ { "scope": "agent|scene|user|project", "scopeName": "", "content": "", "importance": 1 } ],
    "conflictChanges": [ { "title": "", "newStage": "rising|climax|falling|resolved", "intensityDelta": 0.0, "note": "" } ],
    "timelineUpdates": [ { "title": "", "description": "", "participants": [], "causes": [], "consequences": [] } ],
    "unlockedLoreTitles": [ "新解锁的设定标题" ]
  }
  没有变化的字段返回空数组。所有数值变更范围 -1 ~ +1。

- "hiddenIntent"：放在 \`dialogues[]\` 任意一项里，描述说话者的真实意图（玩家看不到）。`;
