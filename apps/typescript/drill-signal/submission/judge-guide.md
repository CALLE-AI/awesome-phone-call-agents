# DrillSignal judge guide

Free, credentialless verification in about five minutes. No personal data required. Fictional reserved numbers only (`+1555010000x`).

## Prerequisites

- Node.js 20 or newer
- npm (bundled with Node)
- Optional: Docker for container verification

## Clean install (recommended)

```bash
cd apps/typescript/drill-signal
npm ci
npm run verify
```

`npm run verify` runs, in order:

1. `npm run check` - TypeScript typecheck
2. `npm test` - 89 source tests (simulation and fake-server; no live calls)
3. `npm run build` - compile to `dist/` and copy `public/` to `dist/public/`
4. `npm run test:dist` - post-build static serving tests against compiled server
5. `npm run smoke:production` - self-terminating `node dist/server.js` health and UI check
6. `npm run demo` - no-network `primary-unavailable-backup-success` flow

Expected demo output (abbreviated):

```text
DrillSignal demo ready at http://127.0.0.1:<port>
Default mode is simulation - no network calls are made.
After-action | status=completed | attempts=[primary@+*******0002:no_answer, backup@+*******0003:success] | ...
No live call was placed (simulation mode).
```

For day-to-day development you may use `npm install` instead of `npm ci` when lockfile changes are expected.

## Interactive UI (simulation)

```bash
npm run dev
```

Open `http://127.0.0.1:3847`. Default bind is loopback; mutating APIs do not require a token on loopback.

Suggested path:

1. Create drill - mode **Simulation**, preset **primary-unavailable-backup-success**
2. Primary `+15550100002`, backup `+15550100003`, check consent boxes
3. Complete **Safety Preview** attestations
4. **Launch** from Mission Control
5. Review **After-Action Report** - masked numbers, scores, evidence excerpts

## Fake-server mode (still credentialless)

1. `npm run dev`
2. Create drill with mode **Fake CALL-E** (uses embedded loopback fake when `CALLE_BASE_URL` is unset)
3. Complete preview and launch as above

No `CALLE_API_KEY` is required. No outbound telephony.

## Docker (optional)

```bash
docker build -t drill-signal .
docker run --rm -p 3847:3847 \
  -e DRILL_SIGNAL_OPERATOR_TOKEN="judge-demo-token-not-a-secret" \
  -v drill-signal-data:/data \
  drill-signal
```

Open `http://127.0.0.1:3847`. Enter the same token in the browser **Operator token** field before creating or launching a drill.

Verify health and static UI:

```bash
curl -s http://127.0.0.1:3847/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3847/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3847/favicon.svg
```

Expected health: `{"ok":true,"defaultMode":"simulation","authRequired":true}`
Expected static: HTTP `200` for `/` (DrillSignal HTML) and favicon.

Stop the container when finished. Remove the image if desired.

## Optional live verification (not required for judging)

Only if you have your own CALL-E API key and authorized phone numbers:

```bash
export CALLE_API_KEY="<your-server-api-key>"
export CALLE_BASE_URL="https://api.heycall-e.com"
npm run dev
```

Select **Live CALL-E** in the UI and complete all consent steps including live side-effect acknowledgment. **This places real outbound calls.**

## Safety boundaries

- Do not use emergency numbers or numbers you are not authorized to call
- Do not commit API keys, operator tokens, or real phone numbers
- Live cancel cannot guarantee provider-side call stop once accepted
- Single-instance JSON store; not multi-tenant production

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE` on port 3847 | Set `PORT=3848` or stop the other process |
| 401 on create/launch in Docker | Set **Operator token** in UI to match `DRILL_SIGNAL_OPERATOR_TOKEN` |
| fake-server error on launch | Enable embedded fake (default) or set valid `CALLE_BASE_URL` |
| 404 on `/` in Docker | Rebuild image; static assets must be in `dist/public/` beside `dist/server.js` |
| `npm ci` fails | Ensure Node 20+; delete `node_modules` and retry |

## Five-minute judge path

| Minute | Action |
| --- | --- |
| 0-1 | `npm ci && npm run verify` |
| 1-2 | Scan passing test summary (89 pass in `npm test`, plus 2 in `npm run test:dist`) |
| 2-4 | `npm run dev`, run simulation preset **primary-unavailable-backup-success** |
| 4-5 | Read after-action report; optional `curl /api/health` on Docker |

No live call, Devpost account, or cloud credentials required for this path.
