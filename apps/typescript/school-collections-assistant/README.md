# School Collections Assistant

CALL-E payment follow-ups for schools.

School Collections Assistant uses CALL-E voice calls to contact parents or guardians about outstanding school payments, have a polite conversation with them, and return a structured summary of the conversation.

**Default mode is fake / no-call.** Live outbound calls are opt-in and gated.

## Problem

Schools often spend significant time manually following up with parents about unpaid school fees.

This usually involves:

* Calling parents individually
* Sending repeated reminders
* Tracking payment commitments manually
* Following up when promised payments are not made

School Collections Assistant automates the first payment follow-up while keeping the conversation polite and human-friendly.

## How It Works

```text
School Admin
     │
     ▼
Web Dashboard (Bearer token)
     │
     ▼
Express API
     │
     ├── fake mode (default) → synthetic structured result
     └── live mode (opt-in)  → CALL-E → Parent / Guardian
```

The school administrator provides:

* Parent/guardian name
* Student name
* Phone number (strict ASCII E.164)
* Outstanding amount
* Payment due date
* School name
* Operator API token

## Safety

Phone calls are real-world side effects. This app enforces:

* Bearer authentication on `POST /api/reminder` via `SCHOOL_COLLECTIONS_API_TOKEN` (separate from the CALL-E key)
* Fake / no-call by default (`CALLE_LIVE_ENABLED` is not `true`)
* Exact per-run destination authorization: the request phone must equal `CALLE_AUTHORIZED_DESTINATION`
* Strict ASCII E.164 validation
* Masked phone numbers in logs and API responses
* Deep masking of provider errors, structured results, and evidence before logging or returning them
* A stable intent / idempotency key derived from the authorized reminder fields
* Explicit `confirmLiveCall: true` for live runs
* Halt for read-only reconciliation under the same intent key when create is ambiguous (no automatic second create/dial)
* Provider-controlled result and error strings rendered as text in the UI (not HTML injection)
* Docs and tests use NANP reserved fictional destinations (`NPA` + `555-01xx`), for example `+12025550100`

## Requirements

* Node.js 18+
* npm
* A CALL-E API key only if you enable live mode

## Installation

```bash
cd apps/typescript/school-collections-assistant
npm install
cp .env.example .env
```

Configure `.env`:

```env
SCHOOL_COLLECTIONS_API_TOKEN=replace-with-a-long-random-secret
CALLE_API_KEY=
CALLE_LIVE_ENABLED=false
CALLE_AUTHORIZED_DESTINATION=
PORT=3001
```

Use `CALLE_API_KEY` for the CALL-E provider credential. Do not use `CALLE_LIVE_API_KEY`.

## Running the Application

```bash
npm start
```

Open `http://localhost:3001` and paste the same `SCHOOL_COLLECTIONS_API_TOKEN` into the operator token field.

Without live enablement the dashboard returns a synthetic structured result and places no call.

## Live mode (opt-in)

Only enable when you control or have explicit permission to call the destination:

```env
CALLE_LIVE_ENABLED=true
CALLE_API_KEY=your_calle_api_key_here
CALLE_AUTHORIZED_DESTINATION=+12025550100
SCHOOL_COLLECTIONS_API_TOKEN=your_operator_token
```

Then submit a request whose `phoneNumber` exactly matches `CALLE_AUTHORIZED_DESTINATION` and set `confirmLiveCall` to `true` (checkbox in the UI).

## Running Tests

```bash
npm test
```

Tests validate authentication, E.164 checks, destination authorization, and the default fake path. They do not place real phone calls and do not require `CALLE_API_KEY`.

## API

### Health

```http
GET /api/health
```

### Start payment reminder

```http
POST /api/reminder
Authorization: Bearer <SCHOOL_COLLECTIONS_API_TOKEN>
Content-Type: application/json
```

Example request:

```json
{
  "parentName": "John Banda",
  "studentName": "Mary Banda",
  "phoneNumber": "+12025550100",
  "amount": "K2,500",
  "dueDate": "2026-09-30",
  "schoolName": "ABC Private School",
  "intentId": "fee-mary-banda-2026-09",
  "confirmLiveCall": false
}
```

Example fake response:

```json
{
  "success": true,
  "mode": "fake",
  "realCallPlaced": false,
  "intentKey": "school-collections:…",
  "phoneMasked": "+120****0100",
  "status": "completed",
  "taskCompleted": true,
  "structuredResult": {
    "payment_awareness": "yes",
    "will_pay": "yes",
    "payment_date": "2026-09-30",
    "parent_response": "Fake dry-run only. No phone call was placed."
  }
}
```

## Privacy and Security

* Keep `CALLE_API_KEY` and `SCHOOL_COLLECTIONS_API_TOKEN` on the server only.
* Never commit `.env`.
* Never expose provider keys in frontend JavaScript, HTML, screenshots, or client requests beyond the operator Bearer token for this app’s own API.

## Current Limitation

CALL-E outbound calling currently has regional availability limitations. In particular, outbound calls to Zambian numbers are currently not supported.

For development and demonstration, use fake mode, or an authorized supported destination number for a controlled live run.

## License

This project is built for hackathon and demonstration purposes.
