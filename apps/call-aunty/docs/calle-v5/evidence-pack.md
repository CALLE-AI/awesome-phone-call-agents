# Evidence pack — Call Aunty × CALL-E

## Automated evidence

| Artifact | Command / path |
|----------|----------------|
| Full CALL-E suite | `pnpm run test:calle` |
| Hero E2E | `tests/hackathon-e2e.test.ts` |
| Client secret guard | `tests/architecture-guard.test.ts` |
| Health gate | `pnpm run calle:health` |
| Release report | tRPC `calle.releaseReport` |

## Test counts (baseline)

Run locally:

```bash
pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts tests/calle-v3.test.ts tests/calle-v4.test.ts tests/calle-v5.test.ts tests/hackathon-e2e.test.ts tests/architecture-guard.test.ts
```

## Synthetic data only

- Beneficiaries: `demo-ben-001` … `demo-ben-010` in `server/calle/demo-data.ts`
- Phones: fictional `+155555501xx` range
- No real patient names in tests or fixtures

## Capability matrix (truthful)

| Capability | Demo | Dry-run | Live |
|------------|------|---------|------|
| Outbound dial | Simulated | No | Yes* |
| Structured results | Yes | Yes | Yes* |
| Transfer | No | No | No |
| Provider cancel | Local | Local | Local |
| Bangla spoken agent | **No** | **No** | **No** |

\*Requires `CALLE_DEMO_MODE=false`, API key, `CALLE_LIVE_CALLS=true`

## Event sample (sanitized)

After hero demo, `calle.callDetail` returns events such as:

- `intent_created`
- `policy_decided`
- `preflight_completed`
- `provider_requested`
- `outcome_extracted`
- `completed`

No transcripts or raw E.164 in event payloads.
