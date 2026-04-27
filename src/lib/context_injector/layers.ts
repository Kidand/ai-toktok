/**
 * The five context layers from blueprint §4. Each builder is pure: it
 * receives the runtime state, returns a string fragment + the names it
 * surfaced (for the trace). The composer in `index.ts` glues them.
 *
 *   L0 Global              — world bible + system rules + JSON contract
 *   L1 Protagonist Pool    — player identity + canon allies/foils
 *   L2 Present Agents      — full AgentProfile cards for in-scene NPCs
 *   L3 Relationship Graph  — 1-2 hop neighbours of the present set
 *   L4 Keyword-triggered   — LoreEntry hits scanned from input + recent
 */

import type {
  AgentProfile, GuardrailParams, LoreEntry, NarrativeBalance,
  NarrativeEntry, ParsedStory, PlayerConfig, Scene,
} from '../types';
import { importGoalModifier } from '../prompts/import-goal';

export interface LayerResult {
  /** Rendered text for this layer (may be empty if the layer had nothing). */
  text: string;
  /** Names / titles surfaced — used for the debug trace. */
  surfaced: string[];
}

// =============================================================================
// L0 — Global
// =============================================================================

/**
 * The world bible block. Always injected. Includes title, setting, rules,
 * narrative tone, the strictness/balance knob expansions, and the JSON
 * output contract. This is essentially the "head" of the legacy world
 * system prompt minus the per-character rendering.
 */
export function buildL0(
  story: ParsedStory,
  guardrail: GuardrailParams,
  balance: NarrativeBalance,
): LayerResult {
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

  const text = `你是一个沉浸式互动叙事引擎。你正在运行一个基于以下故事世界的互动叙事体验。

## 故事世界
标题：${story.title}
${story.summary}

## 世界观设定
时代：${story.worldSetting.era}
类型：${story.worldSetting.genre}
叙事风格：${story.worldSetting.toneDescription}
世界规则：
${story.worldSetting.rules.map(r => `- ${r}`).join('\n')}

## 世界观护栏
${strictnessGuide}
- 如果玩家的行为完全超出世界观，通过合理的剧情方式化解
- 核心角色的基本设定不可被轻易改写
- 玩家的行为会有成功或失败的合理结果

## 叙事风格
${narrativeGuide}

## 剧情推进要求（必须遵守）
每次回复都要让故事实质前进，不能原地踏步。
- 至少发生一件**具体的事**：角色采取行动、揭示新信息、环境/时间变化、人物关系变化、新角色登场或离场
- **禁止**只用不同措辞重复已有场景；**禁止**连续两次以纯观察/沉思为主
- 玩家被动输入时，由你主动引入新事件或角色动作推动剧情前进
- 单次回复 150-400 字；叙事描写占比 ≤ 50%
- 回复结尾把场景推到一个新的节点

## 选项设计（choices）
- 必须是具体行动；至少一个选项要能推动主线
- 避免"等等看"、"再观察"、"暂不行动"

## 交互格式要求
你的每次回复必须严格按照以下JSON格式返回，不要包含任何其他文字：
{
  "narration": "叙事内容",
  "dialogues": [{ "speaker": "角色名", "content": "对话内容" }],
  "choices": [{ "text": "选项描述", "isBranchPoint": false }],
  "interactions": [{ "characterName": "角色名", "event": "互动事件", "reaction": "角色反应", "sentiment": "positive|neutral|negative" }]
}${importGoalModifier(story.project?.buildConfig)}`;

  return { text, surfaced: ['world-bible'] };
}

// =============================================================================
// L1 — Protagonist Pool
// =============================================================================

export function buildL1(
  story: ParsedStory,
  playerConfig: PlayerConfig,
): LayerResult {
  const playerChar = playerConfig.entryMode === 'soul-transfer'
    ? story.characters.find(c => c.id === playerConfig.characterId)
    : playerConfig.customCharacter;
  const entryEvent = story.keyEvents[playerConfig.entryEventIndex];

  const closeAllyIds = new Set(
    (playerChar?.relationships || []).slice(0, 3).map(r => r.characterId),
  );
  const closeAllies = story.characters.filter(c => closeAllyIds.has(c.id));

  const text = `## 玩家角色
模式：${playerConfig.entryMode === 'soul-transfer' ? '魂穿' : '转生'}
角色：${playerChar?.name || '未知'}
身份：${playerChar?.description || ''}
性格：${playerChar?.personality || ''}
背景：${playerChar?.background || ''}

## 当前剧情节点
${entryEvent ? `从"${entryEvent.title}"开始：${entryEvent.description}` : '从故事开头开始'}
${closeAllies.length > 0 ? `\n## 与玩家直接相关的核心角色\n${closeAllies.map(c => `【${c.name}】${c.personality || c.description || ''}`).join('\n')}` : ''}`;

  return { text, surfaced: [playerChar?.name || 'player', ...closeAllies.map(c => c.name)] };
}

// =============================================================================
// L2 — Present Agents
// =============================================================================

export function buildL2(
  story: ParsedStory,
  scene: Scene | undefined,
  agents: AgentProfile[],
  fallbackPresentNames: string[],
): LayerResult {
  // Resolve which AgentProfiles are "in scene" right now.
  // Prefer Scene.presentAgentIds; fall back to name-match against the
  // play page's recent-window heuristic when no Scene record exists.
  let present: AgentProfile[] = [];
  if (scene && scene.presentAgentIds.length > 0) {
    present = agents.filter(a => scene.presentAgentIds.includes(a.id));
  } else {
    const wantNames = new Set(fallbackPresentNames);
    present = agents.filter(a => wantNames.has(a.name));
  }

  if (present.length === 0) {
    return { text: '', surfaced: [] };
  }

  const lines = present.map(a => {
    const goalLine = a.goals && a.goals.length > 0 ? `\n  目标：${a.goals.slice(0, 2).join('；')}` : '';
    const fearLine = a.fears && a.fears.length > 0 ? `\n  顾虑：${a.fears.slice(0, 2).join('；')}` : '';
    const styleLine = a.speechStyle ? `\n  说话风格：${a.speechStyle}` : '';
    const rulesLine = a.behaviorRules && a.behaviorRules.length > 0
      ? `\n  行为规则：${a.behaviorRules.map(r => `当${r.when}就${r.then}`).join('；')}`
      : '';
    return `【${a.name}】${a.persona}${styleLine}${goalLine}${fearLine}${rulesLine}`;
  }).join('\n\n');

  // Locations from the scene (if any) — kept here because they're
  // "present-context" not part of the world bible.
  let locText = '';
  if (scene?.locationId) {
    const loc = story.locations.find(l => l.id === scene.locationId);
    if (loc) locText = `\n\n### 当前地点\n【${loc.name}】${loc.description}`;
  }

  return {
    text: `## 当前在场角色（详细）\n${lines}${locText}`,
    surfaced: present.map(a => a.name),
  };
}

// =============================================================================
// L3 — Relationship Graph Expansion
// =============================================================================

export function buildL3(
  story: ParsedStory,
  agents: AgentProfile[],
  presentAgentIds: string[],
  expandDepth: 0 | 1 | 2,
): LayerResult {
  if (expandDepth === 0 || presentAgentIds.length === 0) {
    return { text: '', surfaced: [] };
  }

  const presentSet = new Set(presentAgentIds);
  const presentEntities = new Set(
    agents.filter(a => presentSet.has(a.id)).map(a => a.entityId),
  );

  // Walk the legacy character.relationships (or `story.relationships` table
  // when populated) to find 1-hop neighbours.
  const neighbourIds = new Set<string>();
  const reasons = new Map<string, string>();
  for (const c of story.characters) {
    if (!presentEntities.has(c.id)) continue;
    for (const rel of c.relationships || []) {
      if (presentEntities.has(rel.characterId)) continue;
      neighbourIds.add(rel.characterId);
      if (!reasons.has(rel.characterId)) reasons.set(rel.characterId, rel.relation);
    }
  }
  // Also fold in the projectId-table relationships (Phase 2 derived).
  for (const r of story.relationships || []) {
    if (presentEntities.has(r.sourceEntityId) && !presentEntities.has(r.targetEntityId)) {
      neighbourIds.add(r.targetEntityId);
      if (!reasons.has(r.targetEntityId)) reasons.set(r.targetEntityId, r.relationType);
    }
  }
  if (expandDepth >= 2) {
    // Expand once more — neighbours of neighbours (capped). Keep it cheap.
    const seeds = [...neighbourIds];
    for (const seed of seeds) {
      const c = story.characters.find(ch => ch.id === seed);
      if (!c?.relationships) continue;
      for (const rel of c.relationships) {
        if (!presentEntities.has(rel.characterId) && !neighbourIds.has(rel.characterId)) {
          neighbourIds.add(rel.characterId);
          reasons.set(rel.characterId, rel.relation + '（间接）');
        }
      }
    }
  }

  if (neighbourIds.size === 0) return { text: '', surfaced: [] };

  const lines: string[] = [];
  for (const id of neighbourIds) {
    const c = story.characters.find(ch => ch.id === id);
    if (!c) continue;
    const reason = reasons.get(id) || '相关';
    lines.push(`【${c.name}】${reason}：${c.description?.slice(0, 60) || c.personality?.slice(0, 60) || ''}`);
  }
  return {
    text: `## 关系扩散（在场角色的近邻）\n${lines.join('\n')}`,
    surfaced: lines.map(l => (l.match(/^【(.+?)】/) || [, ''])[1]).filter(Boolean) as string[],
  };
}

// =============================================================================
// L4 — Keyword-triggered Lore
// =============================================================================

export function buildL4(
  story: ParsedStory,
  history: NarrativeEntry[],
  playerInput: string,
  windowSize: number,
): LayerResult {
  const lore: LoreEntry[] = story.loreEntries || [];
  if (lore.length === 0) return { text: '', surfaced: [] };

  const recentText = history.slice(-windowSize)
    .map(e => `${e.speaker || ''} ${e.content || ''}`).join(' ');
  const scanText = `${recentText} ${playerInput}`;

  const hits: { entry: LoreEntry; matchedKw: string }[] = [];
  for (const entry of lore) {
    const kws = entry.triggerKeywords || [];
    let matched = '';
    for (const kw of kws) {
      if (kw && scanText.includes(kw)) { matched = kw; break; }
    }
    if (matched) hits.push({ entry, matchedKw: matched });
  }
  if (hits.length === 0) return { text: '', surfaced: [] };

  hits.sort((a, b) => (b.entry.importance || 0) - (a.entry.importance || 0));
  const lines = hits.slice(0, 6).map(h =>
    `【${h.entry.title}】(命中"${h.matchedKw}"·重要度${h.entry.importance ?? 3}) ${h.entry.content}`,
  );
  return {
    text: `## 触发的世界设定\n${lines.join('\n')}`,
    surfaced: hits.map(h => h.entry.title),
  };
}

