# Appointment Backfill Operator

Clinic-side appointment recovery reference app for AI-agent phone-call workflows. When a patient cancellation is verified, the app starts a sequential CALL-E-style waitlist outreach flow and records the outcome for clinic staff review.

This is a reference demo, not a production medical scheduling system.

## What It Demonstrates

- Authenticated Express API routes for appointment cancellation, inbound mocks, webhooks, dashboard data, and demo reset.
- Strict patient/appointment matching before a cancellation can touch records.
- E.164 validation before any outbound call attempt.
- Live-call gates that require `ALLOW_LIVE_CALLS=true`, a CALL-E API key from an approved configured origin, and an exact per-run E.164 allowlist in `ALLOWED_LIVE_RECIPIENTS`.
- Masked phone numbers in logs, dashboard payloads, and stored raw call-result payloads.
- Sequential waitlist outreach with no parallel calls.
- Advisory-only accepted backfill results: the app records that a patient accepted, but it does not finalize clinical booking or rescheduling.
- A dashboard monitor that shows in-progress and recent outbound activity.

## Quick Start

```bash
npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000/dashboard`. The dashboard prompts for an operator Bearer token. Use the value of `API_AUTH_TOKEN` if it is configured; otherwise any non-empty local token works for the reference demo.

The seed files use fictional `+1555555...` numbers. Keep `ALLOW_LIVE_CALLS=false` for local demos. Replace seed destinations only with consented, reachable E.164 numbers, and list exact approved destinations in `ALLOWED_LIVE_RECIPIENTS` before enabling live calls.

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/dashboard/stats` | Fetch masked dashboard stats, queue, appointments, and recent calls |
| `POST` | `/api/appointments/cancel` | Cancel a verified patient appointment and trigger advisory backfill |
| `POST` | `/api/inbound/mock` | Simulate an inbound cancellation with exact patient/appointment match |
| `POST` | `/api/webhooks/calle` | Process CALL-E-style webhook results with dedupe and ambiguity handling |
| `POST` | `/api/appointments/reset-demo` | Reset seeded demo data |
| `GET` | `/dashboard` | HTML dashboard UI |

Every `/api/*` request requires `Authorization: Bearer <token>`.

## Environment Variables

```env
DATABASE_URL="file:./dev.db"
PORT=3000
API_AUTH_TOKEN="change-me-for-local-demo"
CALLE_BASE_URL="https://api.heycall-e.com"
CALLE_API_KEY="iams_live_YOUR_API_KEY_HERE"
CALLE_API_KEY_SOURCE="env"
ALLOW_LIVE_CALLS=false
ALLOWED_LIVE_RECIPIENTS="+15555550100,+15555550101"
```

Approved `CALLE_API_KEY_SOURCE` values are `env`, `secret-manager`, and `vault`. The app does not accept provider credentials from request bodies.

## Safety Boundary

This demo is designed to avoid accidental real-world side effects by default:

- No unauthenticated demo bypass exists for patient or call-control API routes.
- Real calls remain mocked unless the live-call switch, credential origin, and exact recipient allowlist all pass.
- Ambiguous or failed call results are logged for manual review and do not book or reschedule appointments.
- Accepted waitlist responses are advisory only. Clinic staff must perform final booking or rescheduling in the system of record.

## Known Limitations

- Not HIPAA-ready: data is stored in plaintext SQLite and the app does not implement consent management, production audit logging, retention enforcement, or encryption at rest.
- No EHR integration: this app uses local demo records only.
- No production job queue: backfill work runs in-process.
- No rate limiting or quiet-hours enforcement.
- No real inbound provider integration; inbound cancellation is simulated.

## Testing

```bash
npm run build
npm test
```

## Project Structure

```text
src/
  index.ts
  middleware/auth.ts
  public/dashboard.html
  routes/
  services/
  utils/
prisma/
  schema.prisma
  seed.ts
__tests__/
```

See [SAFETY.md](SAFETY.md) for deployment considerations and recommended controls that are not fully implemented by this reference app.
