# CALL-E V2 Architecture

## Layer map

```
Expo CHW screen (app/chw/[id].tsx)
  │  prepare / confirm / status  (no secrets)
  ▼
tRPC calle.* (server/routers.ts)
  ▼
CalleService (server/calle/service.ts)
  ├─ loadCalleConfig / toPolicyEnv
  ├─ runPreflight → evaluateCallPolicy
  ├─ assertJobTransition (call-job)
  ├─ evaluateRetry (public metadata)
  ▼
CalleAdapter (DryRun | Live @call-e/calle)
  ├─ buildFollowUpTask (call-plan + content-guard)
  ├─ normalizeStructuredResult
  ▼
mapStructuredResultToFollowUp → local follow-up + sync queue (+ optional DB upsert)
```

## Capability registry

`server/calle/capabilities.ts` is the honesty boundary:

- Supported regions: US, CA, GB, AU
- Supported call languages: en, en-us, en-gb, es, fr
- Explicit **unsupported** claims: Bangladesh, Bangla spoken agent, `bn`

Clients should use `calle.capabilities` for diagnostics — never read env vars.

## Config modes

| Mode | Conditions |
|------|------------|
| `dry_run` | Default; or missing API key; or `CALLE_LIVE_CALLS` off |
| `live` | API key + `CALLE_LIVE_CALLS=true` + kill switch off |
| `disabled` | `CALLE_KILL_SWITCH=true` |

## Prepare → confirm lifecycle

1. **Prepare** — policy + preflight, idempotent workflow in memory, masked E.164 in response
2. **Confirm** — job transition `prepared → starting → terminal`, adapter call, structured result mapping
3. **Status / cancel** — owner-scoped; cancel is local-only (SDK has no cancel API)

## Safety invariants (unchanged)

- No `CALLE_API_KEY` in Expo bundle
- Urgent triage and missing consent → deny
- No auto-dial on mount or sync
- Bangla UI ≠ Bangla spoken call language
