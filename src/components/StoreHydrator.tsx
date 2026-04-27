'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';

/**
 * Mount-once client hook that kicks off `gameStore.init()`. The action is
 * idempotent (module-scope promise dedupes), so it's safe to render this
 * inside the root layout — every page hard-refresh triggers exactly one
 * IndexedDB hydration pass.
 */
export function StoreHydrator() {
  const init = useGameStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  return null;
}
