import { GameSave, ParsedStory } from './types';

const SAVES_KEY = 'ai-toktok-saves';
const STORIES_KEY = 'ai-toktok-stories';
const CONFIG_KEY = 'ai-toktok-config';

/** 保存游戏存档 */
export function saveSave(save: GameSave): void {
  const saves = loadAllSaves();
  const idx = saves.findIndex(s => s.id === save.id);
  if (idx >= 0) {
    saves[idx] = save;
  } else {
    saves.push(save);
  }
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

/** 加载所有存档 */
export function loadAllSaves(): GameSave[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SAVES_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** 加载单个存档 */
export function loadSave(saveId: string): GameSave | null {
  const saves = loadAllSaves();
  return saves.find(s => s.id === saveId) || null;
}

/** 删除存档 */
export function deleteSave(saveId: string): void {
  const saves = loadAllSaves().filter(s => s.id !== saveId);
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

/** 保存解析的故事 */
export function saveStory(story: ParsedStory): void {
  const stories = loadAllStories();
  const idx = stories.findIndex(s => s.id === story.id);
  if (idx >= 0) {
    stories[idx] = story;
  } else {
    stories.push(story);
  }
  localStorage.setItem(STORIES_KEY, JSON.stringify(stories));
}

/** 加载所有故事 */
export function loadAllStories(): ParsedStory[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(STORIES_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** 加载单个故事 */
export function loadStory(storyId: string): ParsedStory | null {
  const stories = loadAllStories();
  return stories.find(s => s.id === storyId) || null;
}

/** 保存 LLM 配置 */
export function saveLLMConfig(config: { provider: string; apiKey: string; model: string }): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** 加载 LLM 配置 */
export function loadLLMConfig(): { provider: string; apiKey: string; model: string } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}
