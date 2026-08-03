# DrillSignal submission packet

Master checklist for hackathon / upstream contribution evidence. Status values: **proven locally**, **pending external**, or **not applicable**.

## Repository and packaging

| Item | Status | Notes |
| --- | --- | --- |
| App README with setup, safety, cancellation | proven locally | `../README.md` |
| `npm ci` reproducible install | proven locally | Uses `package-lock.json` |
| `npm run verify` (check, test, build, test:dist, smoke:production, demo) | proven locally | No network; simulation only |
| Multi-stage Docker image | proven locally | Runtime deps only; non-root user |
| `.dockerignore` | proven locally | Excludes tests, `.data`, secrets |
| Root `python3 scripts/validate_repository.py` | proven locally | Run from repository root |

## Testing evidence

| Item | Status | Notes |
| --- | --- | --- |
| TypeScript check (`npm run check`) | proven locally | |
| Unit and integration tests (`npm test`) | proven locally | 89 tests, 0 failures (see `evidence-manifest.example.json`) |
| Post-build dist static tests (`npm run test:dist`) | proven locally | Compiled `dist/server.js` serves `/`, favicon, assets |
| Production smoke (`npm run smoke:production`) | proven locally | Spawns `node dist/server.js` on ephemeral loopback port |
| Build (`npm run build`) | proven locally | Emits `dist/` and copies `public/` |
| No-network demo (`npm run demo`) | proven locally | `primary-unavailable-backup-success` simulation |
| SDK contract against fake CALL-E server | proven locally | Covered in test suite |
| Docker health check | proven locally | `GET /api/health` via Node fetch |
| Docker static UI | proven locally | `GET /` returns DrillSignal HTML; favicon/assets served from `dist/public/` |

## External handoff and completed evidence

| Item | Status | Placeholder |
| --- | --- | --- |
| Upstream pull request | proven externally | https://github.com/CALLE-AI/awesome-phone-call-agents/pull/56 |
| Local demo video (2:55.91) | proven locally | `drillsignal-demo-final-hd.mp4`; public `VIDEO_URL` pending user upload |
| Devpost submission | pending external | Submit via Devpost UI; do not commit account email |
| CALL-E account email | pending external | Supply only in Devpost form, never in git |
| Hosted deployment URL | pending external | `HOSTED_URL` in evidence manifest (optional) |
| Authorized live CALL-E runtime path | proven externally | Verified separately with user authorization; no credentials, phone numbers, call IDs, or transcript data committed |
| Public live-call evidence | not applicable | Deliberately omitted to protect credentials and personal call data |
| Desktop/mobile browser QA on hosted URL | pending external | After optional deploy |

## Packet contents

| File | Purpose |
| --- | --- |
| [readiness-checklist.md](./readiness-checklist.md) | Dated Devpost requirements, evidence status, judging matrix, and final submission sequence |
| [devpost.md](./devpost.md) | Copy-ready Devpost project description |
| [judge-guide.md](./judge-guide.md) | Credentialless 5-minute judge path |
| [demo-script.md](./demo-script.md) | Timed video storyboard |
| [pr-description.md](./pr-description.md) | Upstream PR title and body |
| [evidence-manifest.example.json](./evidence-manifest.example.json) | Structured evidence schema |

## How to refresh evidence

1. From `apps/typescript/drill-signal`: `npm ci && npm run verify`
2. From repository root: `python3 scripts/validate_repository.py`
3. Copy `evidence-manifest.example.json` to a local untracked file if recording results; never commit secrets, phone numbers, or personal email.
4. Update placeholder URLs and call evidence only after those steps are actually performed.
