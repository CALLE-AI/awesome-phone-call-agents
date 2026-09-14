# CALL-E V3 Status

**Last updated:** 2026-08-23

## Completed pages (partial)

| Page | Topic | Status |
|------|-------|--------|
| 001 | Mission / non-negotiables | ✅ Enforced in code |
| 002 | Repo reconnaissance | ✅ `docs/calle-v3/repo-map.md`, `baseline.md` |
| 003 | Calling domain model | ✅ `phone-task.ts`, `phone-state.ts` |
| 004 | Adapter hardening | ✅ Normalized results, demo fake runtime |
| 005 | Orchestration | ✅ `orchestrator.ts` wired into service |
| 006 | Calling queue | ✅ `queue.ts` + `queueHealth` endpoint |
| 007 | Retry strategy | ✅ Extended `retry-policy.ts` |
| 008–012 | AI planner / prompts / extraction / safety | ✅ Rule-based path + tests |
| 015 | Mock phone runtime | ✅ `FakeCalleRuntime` |
| 016–017 | Mock datasets | ✅ `demo-data.ts` + scenario results |
| 018 | Demo mode | ✅ `CALLE_DEMO_MODE`, fail-closed adapter |

## Test status

```bash
pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts tests/calle-v3.test.ts
pnpm check
```

## Known limitations

- Workflow store remains in-memory (Drizzle `call_workflows` not wired)
- No demo dashboard or scenario runner UI yet (API only)
- AI planner is rule-based; model path reserved
- Live calls require `CALLE_DEMO_MODE=false` + `CALLE_LIVE_CALLS=true` + API key

## Next action

1. Add demo scenario runner screen (mobile or web)
2. Wire `call_workflows` DB persistence with memory fallback
3. Continue pages 019+ (dashboard, call detail UI, consent fixtures)
