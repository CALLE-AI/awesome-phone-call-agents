# CALL-E V5 Architecture

## End-to-end loop (hackathon centerpiece)

```
CHW woman record / command center
  → intent compiler + AI call brief (rule-based)
  → policy + preflight + consent gates
  → prepare (correlation ID + call events)
  → confirm → FakeCalleRuntime | DryRun | Live adapter
  → conversation FSM + orchestrator timeline
  → outcome extraction + confidence gate
  → follow-up mapping + local sync queue
```

## Module map

| Layer | Path |
|-------|------|
| Mobile UI | `app/chw/[id].tsx`, `app/chw/calls.tsx` |
| tRPC | `server/routers.ts` → `calle.*` |
| Service | `server/calle/service.ts` |
| Orchestrator | `server/calle/orchestrator.ts` |
| Events | `server/calle/call-events.ts` |
| Correlation | `server/calle/correlation.ts` |
| V5 flags | `server/calle/v5-flags.ts` |
| Config validator | `server/calle/config-validator.ts` |
| Provider caps | `server/calle/provider-capabilities.ts` |
| AI | `server/ai/call-planner.ts`, `call-brief.ts`, `outcome-extractor.ts` |
| Demo runtime | `server/calle/fake-runtime.ts`, `demo-data.ts` |
| Tests | `tests/calle-*.test.ts`, `tests/hackathon-e2e.test.ts` |
| Health gate | `scripts/calle-health-gate.mjs` |

## Safety invariants

- No `CALLE_API_KEY` in Expo client (see `tests/architecture-guard.test.ts`)
- `CALLE_DEMO_MODE=true` fail-closed → `FakeCalleRuntime` only
- Urgent triage + missing consent → policy deny
- Events store summaries only — no transcripts or raw phones

## Verification

```bash
pnpm run test:calle
pnpm run calle:health
```
