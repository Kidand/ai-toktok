import { ParsedStory } from '../types';
import { breakingBadStory } from './breaking-bad';

/**
 * A preset story is a pre-parsed `ParsedStory` bundled with the app, plus a
 * bit of presentational metadata for the home-page picker. Users can load
 * one directly into /setup without running any LLM parse of their own.
 */
export type Preset = {
  /** Stable key. Mirrors the story's id prefix (e.g. 'breaking-bad'). */
  id: string;
  displayTitle: string;
  /** One-line hook shown on the card. */
  tagline: string;
  /** Genre / era chips to render alongside the card. */
  chips: string[];
  story: ParsedStory;
};

export const PRESETS: Preset[] = [
  {
    id: 'breaking-bad',
    displayTitle: '绝命毒师',
    tagline: '一个身患绝症的化学老师，为家人走上制毒之路。',
    chips: ['现代', '犯罪 · 悬疑', '10 角色'],
    story: breakingBadStory,
  },
];
