# CALL-E V5 — Hackathon FINAL READY

**Date:** 2026-08-23

## One-command verification

```bash
pnpm run calle:health
```

Expected: typecheck + all CALL-E tests pass.

## Judge demo path (3–4 min)

1. Start app: `pnpm dev`
2. Open CHW queue → woman record
3. Show **DEMO** indicator and pre-call sheet (consent, dry-run, English call language)
4. **Prepare** → **Confirm** phone follow-up
5. Show status `dry_run_completed` and follow-up saved locally
6. Open **Call command center** → filter + call detail (events, AI gate, correlation)
7. Optional: run **Hero demo** from command center (one-click synthetic beneficiary)

See [judge-demo-script.md](./judge-demo-script.md) for narration.

## API smoke (authenticated)

- `calle.capabilities` — mode, provider caps, V5 flags
- `calle.validateConfig` — safe config check
- `calle.heroDemo` — full synthetic journey
- `calle.releaseReport` — submission metadata

## Submission assets

| Asset | Path |
|-------|------|
| Architecture | `docs/calle-v5/architecture.md` |
| Demo script | `docs/calle-v5/judge-demo-script.md` |
| Checklist | `docs/calle-v5/submission-checklist.md` |
| Evidence | `docs/calle-v5/evidence-pack.md` |
| Reusable skill | `contrib/awesome-phone-call-agents/README.md` |
| E2E test | `tests/hackathon-e2e.test.ts` |

## Live call (optional coda)

Only after: `CALLE_DEMO_MODE=false`, `CALLE_LIVE_CALLS=true`, `CALLE_API_KEY` set server-side. See `docs/calle-live-test-runbook.md`.

## Honest limitations

- Bangla UI ≠ Bangla spoken call agent
- No Bangladesh region in supported demo set
- SDK has no live transfer; cancel is local-only
- AI is rule-based with schema validation — not a fine-tuned clinical model
