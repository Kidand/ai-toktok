# context_injector

Owns: the L0-L4 prompt-context layering described in `blueprint.md` §4.

Today the work is done by `selectActiveLore` inside `../narrator-browser.ts`
(roughly L1-L3 with a `maxTriggered` token cap). Phase 4 promotes it to a
dedicated module with explicit L0 (global) and L4 (keyword-triggered lore)
plus real token budgeting.
