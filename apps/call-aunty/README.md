# call-mobile-aunty

Community health worker app that uses CALL-E to place **authorized** follow-up phone calls. The Expo app lives in this directory (`call-aunty-2026`).

## CALL-E setup

Server-only environment (never `EXPO_PUBLIC_*`):

```text
CALLE_API_KEY=
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_TIMEOUT_MS=30000
CALLE_POLL_INTERVAL_MS=2000
CALLE_POLL_TIMEOUT_MS=180000
CALLE_MAX_RETRIES=4
CALLE_RETRY_BASE_MS=500
CALLE_MOCK_MODE=true
CALLE_WEBHOOK_SECRET=
CALLE_ALLOWED_REGIONS=US,CA,GB,AU,SG
CALLE_TRANSPORT=rest
CALLE_DEMO_MODE=true
CALLE_LIVE_CALLS=false
```

Default checkout is demo/mock mode: `/api/calle` returns deterministic `call_mock_*` results so CI and UI work without placing a live call. `CALLE_API_KEY` stays on Express; the React Native app only calls `/api/calle/*`.

### Live authorized demo

1. Set `CALLE_DEMO_MODE=false`, `CALLE_MOCK_MODE=false`, `CALLE_LIVE_CALLS=true`, and a server-side `CALLE_API_KEY`. REST is the default transport; `CALLE_TRANSPORT=sdk` keeps `@call-e/calle`.
2. Start `pnpm dev`.
3. Open Settings → **CALL-E phone agent**, or a CHW record → **Open CALL-E phone agent**. Use a consenting E.164 recipient.
4. Confirm the UI shows queued / in-progress / completed / failed, plus structured result and evidence. Server logs must redact keys and full phone numbers.
5. Repeating the same idempotency key does not create a second CALL-E task.
6. Only call recipients who authorized the interaction. Do not collect passwords, OTPs, or payment credentials.

See `docs/calle-api/CALLE_API_UPGRADE.md` for the gateway pack, `docs/calle-api-v4/README.md` for the additive v4 layer, and `docs/calle-v5/` for the existing workflow/command-center stack.

## Scripts

```bash
pnpm test
pnpm check
pnpm test:calle-api
pnpm run calle:health
```

## Expo (iOS, Android, web)

The UI is an Expo Router app (`main`: `expo-router/entry`). `pnpm dev` starts Express on port 3000 and Metro on 8081.

1. From `call-aunty-2026/` run `pnpm dev`.
2. Scan the QR code with Expo Go, or press `a` / `i` / `w` for Android, iOS, or web.
3. Physical devices need the phone and computer on the same network. Override the API origin with `EXPO_PUBLIC_API_BASE_URL` if LAN discovery fails.

Native builds talk to `http://<expo-host>:3000`. Local Expo web maps Metro `8081` to the API on `3000`. Do not import server packages (`express`, `mysql2`, `node:*`) from `app/` or `lib/`.
