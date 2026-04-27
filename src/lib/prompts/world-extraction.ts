/**
 * World extraction prompts for the incremental graph builder.
 *
 * Two flavours:
 *   - INITIAL_PARSE_PROMPT: first chunk only. Bootstraps the entire graph with
 *     no prior context.
 *   - buildIncrementalPrompt(graph): chunk 2..N. Receives the graph accumulated
 *     so far and asks the model to reuse known names + only emit deltas.
 *
 * The shape is deliberately a JSON contract; the parser tolerates extra prose
 * around it (see narrator-browser#extractFirstBalancedJSON).
 */

export interface IncrementalGraphSnapshot {
  characters: { name: string; description?: string }[];
  locations: { name: string }[];
  worldSetting: {
    era?: string;
    genre?: string;
    rules?: string[];
    toneDescription?: string;
  };
}

export const INITIAL_PARSE_PROMPT = `你是一个专业的故事分析AI。解析用户提供的故事文本片段，提取关键信息。
必须返回严格JSON，不要任何其他文字：

{
  "title": "（猜测）故事标题",
  "summary": "本片段梗概（100-200字）",
  "worldSetting": {
    "era": "时代背景",
    "genre": "故事类型",
    "rules": ["世界规则1", "世界规则2"],
    "toneDescription": "叙事风格"
  },
  "newCharacters": [
    { "name": "角色名", "description": "外貌及身份", "personality": "性格", "background": "背景",
      "relationships": [{ "targetName": "关联角色名", "relation": "关系" }] }
  ],
  "newLocations": [ { "name": "地点名", "description": "描述" } ],
  "keyEvents": [
    { "title": "事件标题", "description": "描述", "timeIndex": 0,
      "involvedCharacters": ["角色名"], "locationName": "地点名",
      "causes": [], "consequences": [] }
  ],
  "newFactions": [
    { "name": "", "description": "", "ideology": "", "members": [], "rivals": [] }
  ],
  "newLoreEntries": [
    { "title": "", "content": "", "tags": [], "relatedNames": [], "importance": 3 }
  ],
  "newConflicts": [
    { "title": "", "description": "", "involvedNames": [], "stage": "latent|rising|climax|falling|resolved", "intensity": 0.0 }
  ],
  "timelineDescription": "本片段时间线"
}

注意：
- 提取所有有名字的角色
- **必须包含视角人物/主角**（即使故事以第一人称"我"叙述，或用"他/她"代称而极少提及真名）。
  · 若主角有名字，直接用其名字
  · 若主角全程无名，使用"主角"作为 name，并在 description 里写明"故事的第一人称视角人物"
  · 视角人物通常是玩家最可能想扮演的角色，不能遗漏
- keyEvents 按时间顺序排列
- newFactions / newLoreEntries / newConflicts 字段必须存在；本片段没有内容时填空数组 []`;

export function buildIncrementalPrompt(graph: IncrementalGraphSnapshot): string {
  const charList = graph.characters.length === 0
    ? '（暂无）'
    : graph.characters.map(c => `- ${c.name}：${c.description || '（无描述）'}`).join('\n');
  const locList = graph.locations.length === 0
    ? '（暂无）'
    : graph.locations.map(l => `- ${l.name}`).join('\n');
  const worldInfo = [
    graph.worldSetting.era && `时代：${graph.worldSetting.era}`,
    graph.worldSetting.genre && `类型：${graph.worldSetting.genre}`,
    graph.worldSetting.toneDescription && `风格：${graph.worldSetting.toneDescription}`,
    graph.worldSetting.rules && graph.worldSetting.rules.length > 0 && `规则：${graph.worldSetting.rules.join('；')}`,
  ].filter(Boolean).join('\n') || '（暂无）';

  return `你是一个专业的故事分析AI。解析新的故事片段，**在已有图谱基础上增量更新**。

## 当前已知图谱

### 已知角色（主名）
${charList}

### 已知地点
${locList}

### 已知世界观
${worldInfo}

## 任务

阅读新的片段，按以下规则输出JSON：

1. **已知角色**出现时（可能用别名、称号、代称如"他/她/那人"指代），使用上面列出的**主名**。
   在 \`updatedCharacters\` 中仅提供**新增或变化**的字段（比如新的背景细节、性格侧面）。
2. **新角色**放在 \`newCharacters\`，完整填写所有字段。**特别注意**：如果本片段出现了之前片段未识别到的视角人物/主角（第一人称"我"或代称"他/她"），务必作为新角色添加；若无名字用"主角"作为 name。
3. **新地点**放在 \`newLocations\`；已知地点不必重复。
4. **keyEvents**：本片段发生的关键事件，\`involvedCharacters\` 里的名字必须使用主名（已知）或新角色名。
5. **worldSetting**：只填本片段**新发现或矛盾**的规则/时代/风格信息，其他留空。
6. **summary** 和 **timelineDescription**：只描述本片段内容。

必须返回严格JSON，不要其他文字：

{
  "summary": "本片段梗概",
  "worldSetting": { "era": "", "genre": "", "rules": [], "toneDescription": "" },
  "updatedCharacters": [
    { "name": "使用主名", "description": "（补充新信息）", "personality": "", "background": "",
      "relationships": [{ "targetName": "", "relation": "" }] }
  ],
  "newCharacters": [ /* 同 updatedCharacters 但是新角色，全部字段必填 */ ],
  "newLocations": [ { "name": "", "description": "" } ],
  "keyEvents": [
    { "title": "", "description": "", "timeIndex": 0, "involvedCharacters": [], "locationName": "",
      "causes": [], "consequences": [] }
  ],
  "newFactions": [
    { "name": "", "description": "", "ideology": "", "members": [], "rivals": [] }
  ],
  "newLoreEntries": [
    { "title": "", "content": "", "tags": [], "relatedNames": [], "importance": 3 }
  ],
  "newConflicts": [
    { "title": "", "description": "", "involvedNames": [], "stage": "latent|rising|climax|falling|resolved", "intensity": 0.0 }
  ],
  "timelineDescription": "本片段时间线"
}

补充规则：
- \`newFactions\`：本片段出现的组织/势力/团体（如帮派、官方机构、家族）。\`members\` / \`rivals\` 用人名。
- \`newLoreEntries\`：长尾世界设定（特殊术语、规则细节、地名典故、武功/法术名称等）。每条独立且可单独参考。
- \`newConflicts\`：本片段揭示或推进的冲突（人际/阵营/价值观）。\`stage\` 反映在原文中此刻的状态，不是预测未来。
- \`keyEvents\`.causes / consequences 仅在原文显式提到时填，不要脑补。
- 所有"暂无"字段返回空数组，不要省略字段名。`;
}

/**
 * Final pass over the merged graph. Produces a unified title / summary /
 * timeline / tone, smoothing over the per-chunk fragmentation.
 */
export const POLISH_SYSTEM_PROMPT = `你收到一份整合后的故事图谱（角色/地点/事件/世界观），基于它生成统一的叙事级信息。
返回严格JSON：
{
  "title": "故事统一标题",
  "summary": "整体故事梗概（200-400字，流畅连贯）",
  "toneDescription": "整体叙事风格（一句话）",
  "timelineDescription": "完整时间线描述（按事件顺序串联的叙述）"
}
只返回JSON，不要其他文字。`;
