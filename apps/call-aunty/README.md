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
CALLE_KILL_SWITCH=false
CALLE_LIVE_INTENT_REQUIRED=true
CALLE_LIVE_LOOPBACK_ONLY=true
CALLE_ALLOW_LOOPBACK_OPERATOR=true
CALLE_OPERATOR_TOKEN=
CALLE_APPROVED_ORIGINS=
CALLE_APPROVED_PROVIDER_ORIGINS=https://api.heycall-e.com
CALLE_REJECT_REDIRECTS=true
CALLE_REQUIRE_HTTPS_ORIGIN=true
```

Default checkout is demo/mock mode. `CALLE_API_KEY` stays on Express and is configuration only; it never authorizes a live call. The React Native app uses protected tRPC workflow procedures, not the direct `/api/calle` operator gateway.

### Live authorized demo

1. Set `CALLE_DEMO_MODE=false`, `CALLE_MOCK_MODE=false`, `CALLE_LIVE_CALLS=true`, and a server-side `CALLE_API_KEY`. REST is the only supported live transport.
2. Start `pnpm dev`.
3. Open Settings → **CALL-E phone agent**, or a CHW record → **Open CALL-E phone agent**. Use a consenting E.164 recipient.
4. Confirm the UI shows queued / in-progress / completed / failed, plus structured result and evidence. Server logs must redact keys and full phone numbers.
5. Repeating the same idempotency key does not create a second CALL-E task.
6. Only call recipients who authorized the interaction. Do not collect passwords, OTPs, or payment credentials.

See [`docs/calle-api/PR726_HARDENING.md`](docs/calle-api/PR726_HARDENING.md) for the direct-gateway policy, `docs/calle-api-v4/README.md` for the internal additive v4 layer, and `docs/calle-v5/` for the workflow/command-center stack.

## Scripts

```bash
pnpm test
pnpm check
pnpm test:calle-api
pnpm test:calle-security
pnpm run calle:health
```

## Expo (iOS, Android, web)

The UI is an Expo Router app (`main`: `expo-router/entry`). `pnpm dev` starts Express on port 3000 and Metro on 8081.

1. From `call-aunty-2026/` run `pnpm dev`.
2. Scan the QR code with Expo Go, or press `a` / `i` / `w` for Android, iOS, or web.
3. Physical devices need the phone and computer on the same network. Override the API origin with `EXPO_PUBLIC_API_BASE_URL` if LAN discovery fails.

Native builds talk to `http://<expo-host>:3000`. Local Expo web maps Metro `8081` to the API on `3000`. Do not import server packages (`express`, `mysql2`, `node:*`) from `app/` or `lib/`.
