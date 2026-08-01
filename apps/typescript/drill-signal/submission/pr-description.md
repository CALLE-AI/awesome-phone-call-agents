# Pull request (copy-ready)

## Title

```
feat(apps): add DrillSignal business-continuity phone drill app
```

## Body

```markdown
## Summary

Adds DrillSignal, a TypeScript demo app for consented business-continuity outage drills by phone. The app supports simulation (default, no network), fake-server (loopback CALL-E SDK contract), and opt-in live CALL-E mode with explicit safety preview, deterministic backup escalation, mission control, and masked after-action reports.

## Type

- [x] New runnable app
- [ ] New skill
- [ ] New workflow plugin
- [ ] New provider adapter
- [ ] New scheduler recipe
- [x] README awesome-list entry
- [ ] Safety or documentation update
- [ ] Validation or tooling update

## Checklist

- [x] Repository-facing content is written in English.
- [x] Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.
- [x] No secrets, tokens, private phone numbers, call recordings, or private transcripts are included.
- [x] Real-world side effects are clearly described.
- [x] Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.
- [x] Recurring workflows include cancellation behavior (N/A - single-shot drills only; cancel documented).
- [x] Runnable code has a dry-run, fake-server, or no-call path by default.
- [x] `python3 scripts/validate_repository.py` passes.

## Side effects

| Mode | Side effect |
| --- | --- |
| simulation (default) | None |
| fake-server | Local HTTP to loopback fake only |
| live (opt-in) | One or two outbound CALL-E calls per drill |

Default tests and `npm run demo` use simulation only. **No live call was placed during repository verification.**

## Test plan

- [x] `cd apps/typescript/drill-signal && npm ci`
- [x] `npm run verify` (check, test, build, test:dist, smoke:production, demo)
- [x] `npm test` - 54 tests, 0 failures (plus 2 post-build dist static-serving tests in `npm run verify`)
- [x] `npm run build`
- [x] `npm run demo` - primary-unavailable-backup-success simulation completes
- [x] `python3 scripts/validate_repository.py` from repository root
- [x] Docker multi-stage build; `GET /api/health` and static UI (`GET /`, favicon) respond; operator token required for mutating routes on `0.0.0.0`
- [ ] Optional live CALL-E verification (pending external evidence)

## Credentials

- `CALLE_API_KEY` - live mode only; server environment; never committed
- `DRILL_SIGNAL_OPERATOR_TOKEN` - required when `DRILL_SIGNAL_BIND_HOST` is not loopback

## Cancellation

Cancel is available in Mission Control. Pre-call cancel is immediate. Post-accept cancel stops local orchestration but cannot guarantee provider-side call stop (documented in app README).

## Docker

Multi-stage image: build with full `npm ci`, runtime with `npm ci --omit=dev` only. Non-root user, `/data` volume, port 3847, health check on `/api/health`.
```
