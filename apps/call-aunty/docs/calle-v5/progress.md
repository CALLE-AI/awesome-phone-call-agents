# CALL-E V5 Progress

| Page | Topic | Status | Verification |
|------|-------|--------|--------------|
| PAGE 001 | Architecture snapshot | ✅ | `tests/architecture-guard.test.ts` |
| PAGE 002 | V5 feature flags | ✅ | `tests/calle-v5.test.ts` |
| PAGE 003 | Config validation | ✅ | `tests/calle-v5.test.ts` |
| PAGE 004 | Status normalization | ✅ | `tests/calle-v5.test.ts` |
| PAGE 005 | Event vocabulary | ✅ | `tests/calle-v5.test.ts` |
| PAGE 006 | Correlation IDs | ✅ | `tests/hackathon-e2e.test.ts` |
| PAGE 007 | Clock abstraction | ✅ | `tests/calle-v5.test.ts` |
| PAGE 008 | Health gate script | ✅ | `pnpm run calle:health` |
| PAGE 009 | Progress ledger | ✅ | `node scripts/validate-v5-progress.mjs` |
| PAGE 010 | Architecture regression | ✅ | `tests/architecture-guard.test.ts` |
| PAGE 011–100 | Runtime depth | ⏳ | Incremental — see V4 + hero E2E |

## Changed files (V5 foundation)

- `server/calle/v5-flags.ts`, `config-validator.ts`, `call-events.ts`, `correlation.ts`, `clock.ts`, `status-normalize.ts`, `error-taxonomy.ts`
- `server/calle/service.ts` — events, correlation, hero demo, release report
- `server/routers.ts` — `validateConfig`, `heroDemo`, `releaseReport`
- `tests/calle-v5.test.ts`, `tests/hackathon-e2e.test.ts`, `tests/architecture-guard.test.ts`
- `scripts/calle-health-gate.mjs`, `scripts/validate-v5-progress.mjs`
- `docs/calle-v5/*`

## Limitations

- In-memory workflow/event stores
- Rule-based AI only
- Pages 011–100 (turn orchestration, chaos mode, dead-letter) deferred
