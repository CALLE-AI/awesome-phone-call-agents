# CALL-E V2 Implementation Log

## Scope

Second engineering pass on the Call Aunty × CALL-E integration: capability registry, centralized config, preflight diagnostics, call-job state machine, result normalization, retry metadata, and tRPC diagnostics — without breaking the V1 dry-run vertical slice.

## Completed in this pass

| Area | Change |
|------|--------|
| `server/calle/config.ts` | Wired into `createCalleService` via `loadCalleConfig` / `toPolicyEnv` |
| `server/calle/capabilities.ts` | Single source of truth for supported regions/languages; policy uses registry |
| `server/calle/preflight.ts` | Structured blocking/non-blocking reasons; exposed on prepare + `calle.preflight` |
| `server/calle/call-job.ts` | Legal transition checks on confirm/cancel status updates |
| `server/calle/normalize-result.ts` | Provider result coercion before follow-up mapping |
| `server/calle/retry-policy.ts` | `attemptCount`, `canRetry` on public workflow view |
| `server/calle/types.ts` | `consentSource`, `consentRecordedAt`, workflow `attemptCount` |
| `server/routers.ts` | `calle.capabilities`, `calle.preflight` queries |
| `app/chw/[id].tsx` | Sends `consentSource: "chw_attestation"` on prepare |
| Tests | `tests/calle-v2.test.ts` + existing `calle-workflow.test.ts` |

## Still deferred (V2 pages 022+)

- `call_workflows` Drizzle persistence in `server/db.ts`
- Webhook ingestion + polling refresh for in-flight calls
- Offline intent queue on device
- Audit log table and rate limits
- CHW UI polish (preflight reason chips, retry affordance)

## Validation

```bash
pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts
pnpm check
```

Default runtime remains **dry-run** unless `CALLE_LIVE_CALLS=true` and `CALLE_API_KEY` are set server-side.
