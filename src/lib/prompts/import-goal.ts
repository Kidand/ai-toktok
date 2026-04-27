/**
 * Import goal modifier — appended to the L0 layer based on
 * `IPProject.buildConfig.importGoal`. Each value tilts the runtime in a
 * different direction without rewriting the core prompt.
 *
 *   faithful      — defaults; nothing extra appended.
 *   free_rewrite  — encourage divergence from canon, more aggressive
 *                   relationship dynamics.
 *   companion     — slow burn; minimise external conflict, prioritise
 *                   character emotional beats.
 *   scenario      — high event density per turn; resolve a dilemma per
 *                   1-2 turns instead of dragging.
 */

import type { IPProjectBuildConfig } from '../types/world';

export function importGoalModifier(cfg?: IPProjectBuildConfig): string {
  const goal = cfg?.importGoal;
  switch (goal) {
    case 'free_rewrite':
      return `\n\n## 导入目标 · 自由改写\n你被允许偏离原作设定（角色性格转向、关系颠倒、新人物登场都可以），但偏离必须与世界观底层逻辑一致。每 3 幕至少出现一次原作不会发生的转折。`;
    case 'companion':
      return `\n\n## 导入目标 · 情感陪伴\n降低剧情冲突烈度，把镜头放在角色与玩家的私人时刻。多用沉默、共处、回忆的写法。**禁止**主动制造危机；如果原作冲突逼近，让它在背景里发酵，主线维持低烈度。`;
    case 'scenario':
      return `\n\n## 导入目标 · 剧情推演\n以高事件密度推动。每幕必须有一个具体抉择 / 信息揭露 / 冲突变化。如果玩家选了被动行动，主动施加外部压力（NPC 闯入、突发事件、时间压力）。`;
    case 'faithful':
    default:
      return '';
  }
}
