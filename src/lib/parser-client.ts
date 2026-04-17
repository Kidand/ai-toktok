/** 客户端直接调用 LLM 解析故事（绕过 Next.js API 超时） */

import { callLLMBrowser } from './llm-browser';
import { LLMConfig, ParsedStory, Character, Location, KeyEvent, WorldSetting } from './types';
import { v4 as uuid } from 'uuid';

const CHUNK_MAX_CHARS = 24000;

const PARSE_SYSTEM_PROMPT = `你是一个专业的故事分析AI。你的任务是深度解析用户提供的故事文本片段，提取所有关键信息。

你必须以严格的JSON格式返回分析结果，不要包含任何其他文字。JSON结构如下：

{
  "title": "故事标题（如果文本中没有明确标题，请根据内容生成一个合适的标题）",
  "summary": "本片段梗概（100-200字）",
  "worldSetting": {
    "era": "时代背景描述",
    "genre": "故事类型",
    "rules": ["世界规则1", "世界规则2"],
    "toneDescription": "叙事风格描述"
  },
  "characters": [
    {
      "name": "角色名",
      "description": "外貌及身份简述",
      "personality": "性格特征详述",
      "background": "背景故事",
      "relationships": [
        { "targetName": "关联角色名", "relation": "关系描述" }
      ]
    }
  ],
  "locations": [
    { "name": "地点名", "description": "地点描述" }
  ],
  "keyEvents": [
    {
      "title": "事件标题",
      "description": "事件描述",
      "timeIndex": 0,
      "involvedCharacters": ["角色名1", "角色名2"],
      "locationName": "发生地点名"
    }
  ],
  "timelineDescription": "本片段时间线描述"
}

注意：提取所有有名字的角色，关键事件按时间顺序排列。`;

const MERGE_SYSTEM_PROMPT = `你是一个故事信息整合专家。用户会给你多个片段的解析结果，请合并去重，生成完整统一的故事信息。

要求：
- 合并所有角色，同名角色合并信息
- 合并所有地点，去重
- 合并所有事件，按全局时间排序，重新编号 timeIndex
- 合并世界观设定
- 生成统一标题和完整梗概（200-400字）
- 生成完整时间线描述

返回严格JSON格式（与输入格式相同）。`;

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_MAX_CHARS) {
      if (current.length > 0) { chunks.push(current.trim()); current = ''; }
      if (para.length > CHUNK_MAX_CHARS) {
        for (let i = 0; i < para.length; i += CHUNK_MAX_CHARS) {
          chunks.push(para.slice(i, i + CHUNK_MAX_CHARS));
        }
        continue;
      }
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function extractJSON(response: string): string {
  const match = response.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  return match ? match[1].trim() : response.trim();
}

export type ParseProgress = { phase: string; current: number; total: number };

export async function parseStoryClient(
  config: LLMConfig,
  storyText: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParsedStory> {
  const chunks = splitIntoChunks(storyText);
  const total = chunks.length;
  onProgress?.({ phase: 'split', current: 0, total });

  if (total === 1) {
    onProgress?.({ phase: 'parse', current: 1, total: 1 });
    const response = await callLLMBrowser(
      config, PARSE_SYSTEM_PROMPT,
      `请解析以下故事文本：\n\n${storyText}`,
      { temperature: 0.3, maxTokens: 8192 },
    );
    onProgress?.({ phase: 'build', current: 1, total: 1 });
    return buildParsedStory(response, storyText);
  }

  const chunkResults: string[] = [];
  for (let i = 0; i < total; i++) {
    onProgress?.({ phase: 'parse', current: i + 1, total });
    const response = await callLLMBrowser(
      config, PARSE_SYSTEM_PROMPT,
      `（这是第 ${i + 1}/${total} 段）\n\n请解析以下故事文本片段：\n\n${chunks[i]}`,
      { temperature: 0.3, maxTokens: 4096 },
    );
    chunkResults.push(extractJSON(response));
  }

  onProgress?.({ phase: 'merge', current: 0, total: 1 });
  const mergeInput = chunkResults.map((r, i) => `=== 片段 ${i + 1}/${total} ===\n${r}`).join('\n\n');
  const mergedResponse = await callLLMBrowser(
    config, MERGE_SYSTEM_PROMPT, mergeInput,
    { temperature: 0.2, maxTokens: 8192 },
  );
  onProgress?.({ phase: 'build', current: 1, total: 1 });
  return buildParsedStory(mergedResponse, storyText);
}

function buildParsedStory(response: string, originalText: string): ParsedStory {
  const jsonStr = extractJSON(response);
  const parsed = JSON.parse(jsonStr);
  const storyId = uuid();

  const characters: Character[] = (parsed.characters || []).map(
    (c: { name: string; description: string; personality: string; background: string }) => ({
      id: uuid(), name: c.name, description: c.description || '',
      personality: c.personality || '', background: c.background || '',
      relationships: [], isOriginal: true,
    }),
  );

  const nameToId = new Map(characters.map(c => [c.name, c.id]));
  (parsed.characters || []).forEach(
    (c: { relationships?: { targetName: string; relation: string }[] }, i: number) => {
      if (c.relationships) {
        characters[i].relationships = c.relationships
          .filter(r => nameToId.has(r.targetName))
          .map(r => ({ characterId: nameToId.get(r.targetName)!, relation: r.relation }));
      }
    },
  );

  const locations: Location[] = (parsed.locations || []).map(
    (l: { name: string; description: string }) => ({ id: uuid(), name: l.name, description: l.description || '' }),
  );
  const locNameToId = new Map(locations.map(l => [l.name, l.id]));

  const keyEvents: KeyEvent[] = (parsed.keyEvents || []).map(
    (e: { title: string; description: string; timeIndex: number; involvedCharacters: string[]; locationName?: string }) => ({
      id: uuid(), title: e.title, description: e.description, timeIndex: e.timeIndex,
      involvedCharacterIds: (e.involvedCharacters || []).map(n => nameToId.get(n)).filter(Boolean) as string[],
      locationId: e.locationName ? locNameToId.get(e.locationName) : undefined,
    }),
  );

  const worldSetting: WorldSetting = {
    era: parsed.worldSetting?.era || '未知', genre: parsed.worldSetting?.genre || '未知',
    rules: parsed.worldSetting?.rules || [], toneDescription: parsed.worldSetting?.toneDescription || '',
  };

  return {
    id: storyId, title: parsed.title || '未命名故事', originalText,
    summary: parsed.summary || '', worldSetting, characters, locations, keyEvents,
    timelineDescription: parsed.timelineDescription || '',
  };
}
