# CALL-E V2 Final Validation

**Date:** 2026-08-23

## Commands

| Command | Result |
|---------|--------|
| `pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts` | **22/22 pass** |
| `pnpm check` | **pass** |

## Invariants verified

- [x] No `CALLE_API_KEY` references under `app/`
- [x] Default mode is dry-run without server secrets
- [x] Urgent triage and missing consent deny live placement
- [x] Unsupported region/language (e.g. BD, bn) denied honestly
- [x] Prepare is idempotent for same action token
- [x] Confirm requires matching initiator + prepare token
- [x] Illegal job transitions throw (state machine guard)
- [x] Provider results normalized before follow-up mapping
- [x] Capabilities endpoint exposes no secrets

## Manual smoke (recommended)

1. Open CHW detail screen → Prepare CALL-E workflow
2. Confirm dry-run badge and masked recipient
3. Confirm → follow-up draft populated locally
4. Optional: `calle.capabilities` and `calle.preflight` via authenticated client

## Known gaps

- In-memory workflow store only (Drizzle `call_workflows` table not wired)
- No webhook/polling for long-running live calls
- SDK cancel is local-only
