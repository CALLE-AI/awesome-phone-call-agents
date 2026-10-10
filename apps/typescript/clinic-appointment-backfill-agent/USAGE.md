# Usage

This app is a reference demo for clinic appointment cancellation and advisory waitlist backfill phone-call workflows.

## Setup

```bash
npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000/dashboard` and enter an operator Bearer token. If `API_AUTH_TOKEN` is set, use that exact value. If it is unset, any non-empty token works for local reference demos.

## Authentication

All `/api/*` routes require:

```http
Authorization: Bearer <token>
```

There is no unauthenticated `DEMO_MODE` bypass for patient-record or call-control routes.

## Demo Flow

1. Reset or seed demo data.
2. Choose a patient.
3. Choose one of that patient's active appointment slots.
4. Simulate an inbound cancellation or trigger outbound backfill.
5. Watch the Live outbound monitor for `IN_PROGRESS`, completed, failed, or no-answer call evidence.

Cancellation submissions must include both `patient_id` and `appointment_id`. The API rejects mismatches instead of inferring a patient from the appointment.

## Live Calls

Keep `ALLOW_LIVE_CALLS=false` unless a real run is explicitly approved.

Real outbound calls require all of the following:

```env
ALLOW_LIVE_CALLS=true
CALLE_API_KEY="iams_live_..."
CALLE_API_KEY_SOURCE="env"
ALLOWED_LIVE_RECIPIENTS="+15555550100,+15555550101"
```

Approved `CALLE_API_KEY_SOURCE` values are `env`, `secret-manager`, and `vault`. `ALLOWED_LIVE_RECIPIENTS` must contain every exact E.164 destination for that run. Provider credentials are read from configured environment/secret origins only; do not send credentials in request bodies.

## API Examples

```bash
curl -H "Authorization: Bearer change-me-for-local-demo" \
  http://localhost:3000/api/dashboard/stats
```

```bash
curl -X POST http://localhost:3000/api/inbound/mock \
  -H "Authorization: Bearer change-me-for-local-demo" \
  -H "Content-Type: application/json" \
  -d '{"appointment_id":"appt-id","patient_id":"patient-id","action":"CANCEL","reason":"Patient requested cancellation"}'
```

## Clinical Boundary

Backfill acceptance is advisory only. The app records that a patient accepted an offered slot, but it does not finalize clinical booking or rescheduling. Clinic staff or the system of record must perform final scheduling decisions.

## Tests

```bash
npm run build
npm test
```