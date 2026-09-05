# Controlled live CALL-E setup

E-mploye supports two execution modes behind the same preview → approval → call → review flow:

| Mode | Purpose | Phone call | Where it is enabled |
| --- | --- | --- | --- |
| CALL-E sandbox | Public demo, development, and automated tests | Never | Default when live readiness is incomplete |
| Live CALL-E | One controlled integration proof | Yes, after manager approval | Local, Docker, or a private deployment |

The public Vercel deployment is intentionally hard-coded to sandbox mode. This prevents a public judge link from spending credits or calling a recipient by accident.

## Live readiness contract

The live provider is selected only when all six provider conditions are true on the server. The live-capable HTTP surface also requires the separate app bearer token:

1. `CALLE_LIVE_ENABLED=true` explicitly opts into live execution.
2. `CALLE_API_KEY` contains a server-side CALL-E API key.
3. `CALLE_BASE_URL` is the official HTTPS origin `https://api.heycall-e.com` (the default); other origins fail closed.
4. `CALLE_TEST_PHONE` is a valid E.164 number (`+` followed by 8–15 digits) that belongs to you or is explicitly authorized for testing.
5. `CALLE_TEST_REGION` is an explicit supported destination region.
6. `CALLE_TEST_LOCALE` is an explicit locale matching that region.

`EMPLOYE_API_TOKEN` protects the live-capable app API. Every API route, including health/state reads, workspace configuration, reset, call creation, status/result refresh, approval, rejection, retry, cancellation, and apply, requires `Authorization: Bearer <EMPLOYE_API_TOKEN>`.

If any condition is missing, E-mploye safely uses `FakeCallProvider`, reports `FAKE · NO CALLS`, and does not claim that a live call is available. A configured key is never returned to the browser; the dashboard exposes only boolean readiness indicators.

When live mode is ready, the persisted workspace starts empty by design. The operator must load one contact and one scheduled context from the **Live mode setup** panel before an approval can be created. The contact phone must exactly match the server-authorized `CALLE_TEST_PHONE`; the full number stays server-side and is masked in previews, responses, and events.

## Environment variables

All variables below are server-only. Use a local `.env`, a private deployment secret store, or Docker runtime secrets. Never use `VITE_` for the API key.

| Variable | Required for live | Description |
| --- | --- | --- |
| `CALLE_API_KEY` | Yes | CALL-E Developer API key. Never commit or put it in frontend variables. |
| `CALLE_LIVE_ENABLED` | Yes | Must be `true`, `1`, or `yes`; this is the explicit safety opt-in. |
| `CALLE_TEST_PHONE` | Yes | Authorized E.164 destination used for controlled testing. |
| `CALLE_BASE_URL` | No | CALL-E API origin; defaults to `https://api.heycall-e.com`. |
| `CALLE_TEST_REGION` | Yes | Destination region sent to CALL-E, for example `US`. |
| `CALLE_TEST_LOCALE` | Yes | Destination locale sent to CALL-E, for example `en-US`. |
| `EMPLOYE_API_TOKEN` | Yes | Separate bearer token for the app API; never reuse `CALLE_API_KEY`. |
| `CALLE_DEFAULT_LANGUAGE` | No | Fallback language when no test locale is set. |
| `CALLE_DEFAULT_REGION` | No | Fallback region when no test region is set. |
| `EMPLOYE_PORT` | No | Node API port; defaults to `8787`. |
| `EMPLOYE_STATE_FILE` | No | JSON state path; use persistent storage only for private deployments. |

The live server fails closed with `503 authentication_not_configured` if the live flag is enabled without `EMPLOYE_API_TOKEN`. The public Vercel handler explicitly forces fake mode and disables this requirement. If the dashboard is built to call a private live server directly, set `VITE_EMPLOYE_API_TOKEN` at build time; that value is browser-visible, so a private authenticated proxy is preferable for production.

Start from the committed template:

```text
copy .env.example .env
```

Then fill only the server-side values. `.env` is ignored by Git and must remain local.

## Safe PowerShell setup

This pattern keeps the key out of the PowerShell command history and out of the repository:

```powershell
Set-Location 'C:\path\to\e-mploye-for-calle'
$secureKey = Read-Host 'CALL-E API key (entrada oculta)' -AsSecureString
$env:CALLE_API_KEY = (New-Object System.Net.NetworkCredential('', $secureKey)).Password
$env:CALLE_LIVE_ENABLED = 'true'
$env:CALLE_TEST_PHONE = '+15551234567'
$env:CALLE_TEST_REGION = 'US'
$env:CALLE_TEST_LOCALE = 'en-US'
$secureAppToken = Read-Host 'E-mploye app API bearer token (entrada oculta)' -AsSecureString
$env:EMPLOYE_API_TOKEN = (New-Object System.Net.NetworkCredential('', $secureAppToken)).Password
# If the dashboard calls this server directly, this is browser-visible; prefer a private auth proxy.
$env:VITE_EMPLOYE_API_TOKEN = $env:EMPLOYE_API_TOKEN
npm run dev
```

The environment variables apply only to that PowerShell process and its children. Close the terminal when finished. Do not paste the key into the browser, a screenshot, a chat message, a `.env` committed to Git, or a Vite variable.

## Docker setup

Build the image without copying secrets into it. Pass the environment at runtime:

```powershell
docker build -t e-mploye-for-calle .
docker run --rm -p 8787:8787 --env-file .env e-mploye-for-calle
```

The container serves the built dashboard and API on `http://localhost:8787`. For a private deployment, put the same variables in the platform's server-side secret configuration instead of baking them into the image.

## Dashboard verification

1. Open the local or private dashboard and select **Live mode setup**.
2. Confirm that **API key** is `Configured · server only`, the authorized phone is masked, and region/locale are ready.
3. Load one contact and one scheduled context. The form rejects a phone that does not exactly match the server-authorized E.164 destination.
4. Confirm **Live CALL-E** says `Ready` and the header says `LIVE CALL-E`.
5. Click **Preview task** and verify the destination is masked, the region/locale are correct, and the exact task says not to promise or apply a change.
6. Click **Request approval**. This does not call anyone.
7. Confirm the explicit **Authorize call** boundary, then authorize only the controlled test once.
8. Follow **CALL-E EXECUTION TRACE**: authorization → provider task → status/result → human review.
9. Inspect the returned status, structured result, transcript, and evidence. Apply a scheduling change only after checking the result.

The **Live mode setup** panel intentionally accepts workspace data, not credentials. It cannot switch a server from fake to live from the browser: the API key, app bearer token, official origin, explicit flag, authorized phone, region, and locale stay in server configuration. Loading the workspace only prepares one controlled target; the manager approval still gates the actual provider request.

## Health and troubleshooting

The server exposes a non-secret health response:

```text
GET /api/health
```

In live mode, health is protected like every other API route:

```text
Authorization: Bearer <EMPLOYE_API_TOKEN>
```

Useful fields under `runtime` are:

- `provider`: the active provider, `fake` or `live`.
- `liveRequested`: whether the explicit flag was enabled.
- `liveReady`: whether all required server-side values are valid and present.
- `apiKeyConfigured`: only a boolean; the key itself is never returned.
- `testPhoneConfigured`: only a boolean indicating a valid E.164 test phone.
- `testRegionConfigured` and `testLocaleConfigured`: only booleans for the configured destination contract.
- `workspaceConfigured`: whether the live workspace has been loaded into the current persisted state.

Common outcomes:

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Header says `FAKE · NO CALLS` | Live is disabled or incomplete | Check the flag, key, and E.164 test phone; restart the server. |
| `Waiting for config` in Live mode setup | The flag is on but readiness is incomplete | Fill the missing server-only value shown by the status cards. |
| Preview blocks the call | Safety validation failed | Check E.164 formatting, region, locale, and task content. |
| Provider returns an error | CALL-E rejected or could not complete the request | Inspect the sanitized failure message and verify API access, destination support, and request schema. |
| No cancellation in live mode | The current CALL-E adapter does not claim provider cancellation | Do not present cancellation as a live capability; fake mode supports cancellation for demos. |

The integration must be tested with a supported destination region and matching locale. Argentina (`AR`) is not currently listed as supported in the project integration notes; do not use an unverified destination for the live proof.

## Safety checklist before a live call

- Use a fresh or rotated key if a key was ever pasted into chat, terminal output, or a screenshot.
- Use a phone number you own or have explicit permission to call.
- Verify the destination region and locale against the current CALL-E documentation.
- Confirm the preview and masked number before authorizing.
- Make at most one controlled test call before recording any live proof; a live call is optional for the public hackathon demo.
- Keep the manager approval step enabled; never bypass it for a demo shortcut.
- Leave the public Vercel deployment in fake-only mode.
- Reset the local/private state after testing if the environment contains personal contact data.
