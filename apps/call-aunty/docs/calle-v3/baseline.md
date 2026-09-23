# CALL-E V3 Baseline

Captured before V3 edits on 2026-08-23.

## Commands

| Command | Result |
|---------|--------|
| `pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts` | 22/22 pass |
| `pnpm check` | pass |

## Notes

- V1/V2 CALL-E vertical slice is intact (prepare → confirm → follow-up mapping).
- Workflow store is in-memory; `call_workflows` Drizzle table exists but is unused.
- Default mode is dry-run unless server env opts into live calls.
