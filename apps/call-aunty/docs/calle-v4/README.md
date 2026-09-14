# CALL-E V4

Fourth engineering pass: **call command center**, **provider capability registry**, **intent compiler**, **conversation simulation**, **AI call briefs**, and hackathon evidence — built on V1–V3 without rewriting working flows.

## Architecture map

```
Expo CHW UI (calls command center, woman detail, follow-up)
  │  tRPC calle.*  (no secrets)
  ▼
Call Command Center (list / filter / detail)
  ▼
CalleService + PhoneCallOrchestrator
  ├─ Intent compiler → typed call plan
  ├─ Policy + preflight + consent
  ├─ AI call brief (rule-based fallback)
  ├─ Conversation state machine (simulator)
  ▼
Provider layer
  ├─ FakeCalleRuntime (demo — fail closed)
  ├─ DryRunCalleAdapter
  └─ LiveCalleAdapter (@call-e/calle)
  ▼
Structured events → follow-up mapping → sync queue
```

## V4 feature flags (server env)

| Variable | Default | Meaning |
|----------|---------|---------|
| `CALL_E_ENABLED` | `true` | Master switch for CALL-E procedures |
| `AI_ENABLED` | `true` | AI brief/planner paths (falls back to rules) |
| `CALLE_DEMO_MODE` | `true` | Demo runtime; blocks live provider |
| `CALLE_LIVE_CALLS` | `false` | Opt-in live calling |
| `CALLE_API_KEY` | empty | Server-only provider key |
| `CALLE_KILL_SWITCH` | `true` off | Hard disable outbound calls |

Fresh checkout is **safe by default**: demo mode on, live calls off, no accidental carrier dial.

## Verification

```bash
pnpm exec vitest run tests/calle-workflow.test.ts tests/calle-v2.test.ts tests/calle-v3.test.ts tests/calle-v4.test.ts
pnpm check
```

## Progress

See [progress.md](./progress.md) for page-by-page status.
