# agent_factory

Owns: turning `WorldEntity { type: 'character' }` into runtime `AgentProfile`
records (goal/fear/secret/behaviorRules/relationshipMap/memorySeed).

Phase 0: empty (prompt staged at `../prompts/agent-persona.ts`).
Phase 3: `createAgentsFromWorld(projectId)` lands here.
