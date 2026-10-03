# CALL-E V3 Changelog

## 2026-08-23 — Foundation pass (pages 001–020 partial)

### Added
- `server/calle/phone-task.ts`, `phone-state.ts` — canonical phone-task model + state machine
- `server/calle/fake-runtime.ts` — deterministic demo scenarios (8 outcomes)
- `server/calle/demo-data.ts` — 10 synthetic beneficiaries
- `server/calle/demo-mode.ts` — fail-closed demo configuration (`CALLE_DEMO_MODE`)
- `server/calle/queue.ts` — in-memory queue with lease semantics
- `server/calle/orchestrator.ts` — policy + AI plan + outcome extraction + event timeline
- `server/ai/*` — rule-based call planner, prompt registry, outcome extractor, safety checks
- tRPC: `calle.demoCatalog`, `calle.runDemoScenario`, `calle.callTimeline`, `calle.queueHealth`
- `tests/calle-v3.test.ts`
- Docs: `docs/calle-v3/baseline.md`, `repo-map.md`, `STATUS.md`

### Changed
- `createCalleAdapter` uses `FakeCalleRuntime` when demo mode is active
- `createCalleService` emits orchestration events; confirm returns AI outcome metadata
- CHW screen shows server mode indicator (`DEMO` / `DRY_RUN` / `LIVE_ELIGIBLE`)

### Deferred
- Demo dashboard UI, scenario runner screen, DB persistence for workflows
- Live-call rehearsal runbook (page 098), submission asset generator (page 097)
