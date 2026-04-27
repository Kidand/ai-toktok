# dialogue_orchestrator

Owns: per-turn loop — Observe → Decide who speaks → Generate → Emit StateDelta.

Today this is the body of `streamNarrationBrowser` in `../narrator-browser.ts`
(single LLM call, JSON contract). Phase 5 splits responder selection from
generation and adds explicit `hiddenIntent` + `stateDelta` fields.
