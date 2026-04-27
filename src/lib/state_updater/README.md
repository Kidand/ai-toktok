# state_updater

Owns: applying `StateDelta` to the persisted world — relationship changes,
agent memory writes, conflict transitions, timeline appends.

Phase 5 introduces the StateDelta type and the `applyStateDelta()` entry
point. Today the equivalent work is the implicit
`addCharacterInteractions()` call in `play/page.tsx`.
