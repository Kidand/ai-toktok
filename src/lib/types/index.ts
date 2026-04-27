/**
 * Barrel for the new modular type tree. The legacy `src/lib/types.ts`
 * re-exports from here, so consumers can keep `import { ... } from '@/lib/types'`
 * unchanged.
 */

export * from './world';
export * from './agent';
export * from './scene';
export * from './runtime';
