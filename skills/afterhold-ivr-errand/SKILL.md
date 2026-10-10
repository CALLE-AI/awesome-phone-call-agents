---
name: afterhold-ivr-errand
description: Run one outbound CALL-E call (mock by default, live only with explicit confirmation) on behalf of a user, capture the conversation, and return a structured brief. AfterHold owns the safety layer, the workspace, and the mission state machine; CALL-E owns the call and the conversation runtime. This skill is a portable workflow: given an authorized E.164 number, a natural-language goal, a language, a schedule, and a result schema, build a CALL-E task, run it (or dry-run), poll status, and persist the brief.
---

# afterhold-ivr-errand

AfterHold is a workspace + safety layer in front of the [CALL-E](https://call-e.devpost.com) call runtime.
You (the assistant using this skill) send one outbound call per "mission", poll until terminal, and
write a structured brief. You do not hold CALL-E keys — the AfterHold API does. You talk to
`AFTERHOLD_API_BASE` over HTTPS with a JWT bearer token.

## When to use

Use this skill when the user wants to delegate a phone task to CALL-E without making the call
themselves. Examples:

- "Call BlueDart and ask if AWB 8821 is out for delivery."
- "Reschedule my 4:30 PM appointment at Dr. Mehta's clinic to tomorrow."
- "Confirm a 7:30 PM table for two at Pizza Hut Bandra."
- "Check the status of my electricity outage ticket."

Do **not** use this skill for:

- Anything requiring payments, money movement, or account cancellation (refused by policy).
- Medical advice or clinical interpretation (refused by policy).
- Legal advice or legal-record destruction (refused by policy).
- Mass/batch calls (v1 is one recipient per mission).

## Inputs

The user (or another tool) supplies:

| Field | Type | Required | Notes |
|---|---|---|---|
| `e164` | string (E.164) | yes | Destination phone. Must be on the user's allowlist. |
| `display_name` | string | yes | Human label, e.g. "BlueDart Chennai Hub". |
| `goal` | string | yes | Natural-language description of what to achieve. |
| `language` | BCP-47 | no | Default `en-IN`. |
| `archetype` | enum | no | `courier` \| `clinic` \| `restaurant` \| `utility` \| `general`. Default `general`. |
| `schedule_at` | ISO ms | no | Default `null` (call now). If set, the server will start when due. |
| `extract_schema` | JSON Schema | no | Default canonical envelope (see [references/result-schema.md](references/result-schema.md)). |

## Outputs

The skill returns a `Brief`:

```json
{
  "outcome": "resolved" | "needs_human" | "voicemail" | "unavailable" | "refused" | "failed",
  "summary_for_user": "string",
  "facts": { "...": "..." },
  "next_step": "string?",
  "callee_role": "string?",
  "confidence": 0..1,
  "evidence": [{ "quote": "..." }]
}
```

If the call did not reach a human (`voicemail` / `unavailable` / `refused` / `failed`), the brief
still returns — do not retry without surfacing the failure to the user.

## Side effects

- One outbound CALL-E call. In the default mock mode no call is placed. A mission with a future
  `schedule_at` is stored as `scheduled` and dialed by the server at that time, not now.
- The destination receives a phone call from CALL-E's voice runtime on behalf of the user.
- The AfterHold server stores the mission, all events, and the resulting brief.
- The CALL-E free tier is 20 calls per new account. The server enforces a 5-call-per-hour rate limit per user.

## Cancellation

The user can cancel a mission:

```
POST /v1/missions/:id/cancel
```

What cancel does, and does not do:

- A mission that has not been sent to CALL-E yet (`draft`, `previewed`, `scheduled`) is canceled and
  will never be dialed.
- A mission whose call CALL-E has already accepted is marked `canceled` locally and AfterHold stops
  tracking it. **This does not recall the call.** It may still ring, connect and complete. The response
  says `call_recalled: false`. Use the CALL-E dashboard if you need to stop an in-flight call.
- A mission in `submission_unknown` is canceled locally the same way; check the CALL-E dashboard to see
  whether the call exists.

## Credentials

AfterHold API requires:

- `AFTERHOLD_API_BASE` — base URL. Defaults to `http://127.0.0.1:8787`. A non-local server must be
  `https` and must also be approved with `AFTERHOLD_ALLOW_ORIGIN=<same origin>`. Credentials are never
  sent to any other origin and redirects are refused.
- `AFTERHOLD_JWT` — bearer token. Get one by calling `POST /v1/auth/login` with the user's email + password.
- `CALLE_API_KEY` is **never** used by callers. It lives only on the AfterHold server, which only sends
  it to `https://api.heycall-e.com` or `https://test-api.heycall-e.com`.

If `AFTERHOLD_API_BASE` or `AFTERHOLD_JWT` is missing, **stop and tell the user** rather than guessing.

## Dry-run (the default)

The server runs in **mock mode by default** (`CALLE_MOCK=1`). The mock adapter walks the same phase
timeline (`queued → planning → dialing → in_conversation → wrapping → completed`) with a believable
transcript and a courier-style brief. No call is placed and no CALL-E key is needed. All sample numbers
are fictional `555-01xx` numbers.

```bash
cd apps/typescript/afterhold-api && npm install && npm run dev     # mock mode, 127.0.0.1 only
node skills/afterhold-ivr-errand/scripts/dry-run.mjs               # in another terminal
```

`dry-run.mjs` only talks to a loopback server and exits before sending anything if `/health` does not
report `mock: true`. See [references/server.md](references/server.md).

## Workflow

```mermaid
flowchart LR
  U[User goal + E.164] -->|POST /v1/missions| S[draft]
  S -->|POST /v1/missions/:id/preview| P[previewed]
  P -->|POST /v1/missions/:id/start| Q[queued]
  Q -->|worker polls| L[planning → dialing → in_conversation → wrapping]
  L -->|terminal| T[completed | voicemail | failed | canceled]
  T -->|GET /v1/missions/:id| B[Brief]
```

### Step 1 — Create a draft mission

```
POST /v1/missions
Authorization: Bearer $AFTERHOLD_JWT
Content-Type: application/json

{
  "e164": "+12025550143",
  "display_name": "BlueDart Chennai Hub",
  "goal": "Check if AWB 8821 is out for delivery today. If delayed, get the rider contact and reschedule for tomorrow morning.",
  "language": "en-IN",
  "archetype": "courier"
}
```

→ returns a mission with `status: "draft"`. Save `id` and `idempotency_key` (the server already dedupes).

### Step 2 — Preview (auto-generates the task string)

```
POST /v1/missions/{id}/preview
```

→ returns `task_string` (read it back to the user before live), `extract_schema`, status `previewed`.
The task string is rendered from a deterministic template; see [references/task-template.md](references/task-template.md).

### Step 3 — Start (gates + create the call)

```
POST /v1/missions/{id}/start
```

Gates the server runs:

0. Live mode only: the request body must be `{"confirm_live": true}` and the mission must have a
   `region` (ISO 3166-1 alpha-2, never inferred). Otherwise `400`.
1. `CALLE_ENABLED` env is `1`. If `0`, return `503`.
2. User has granted explicit consent. If not, return `412`.
3. `e164` is on the user's allowlist (skipped under `CALLE_MOCK=1`). Otherwise `403`.
4. The actual dial time is outside quiet hours. Otherwise `429`.
5. Rate limit: ≤5 starts per user per hour. Otherwise `429`.

**Scheduling.** `schedule_at` must be in the future (past values are `400`) and is checked against
quiet hours at that time. Starting such a mission stores it as `scheduled`; it is not dialed now. The
server's sweeper dials it when due and re-runs every gate at that moment, so a schedule cannot be used
to get around quiet hours, a revoked consent, or the kill switch.

If all gates pass, the server atomically claims the mission and creates the call via CALL-E
(`POST /v1/calls`), then a background worker polls `GET /v1/calls/{id}` every `POLL_INTERVAL_SEC`
(8s by default; 1.5s under `CALLE_MOCK=1`). First poll waits `POLL_FIRST_DELAY_SEC` (60s live, 0 mock).

**Unknown creation.** If the create request times out, drops, or returns 5xx, the call may exist. The
mission becomes `submission_unknown`: it is never auto-retried or replaced, and `/retry` returns `409`
until you check the CALL-E dashboard and reconcile it.

### Step 4 — Stream events

```
GET /v1/missions/{id}/events?since={seq}
```

Use this for an on-screen "neural stream" (transcript, phase, transcript excerpts). The server
appends one event per status change and one per callee transcript line. The iOS client polls
this every 1.5s while the Live Call screen is open.

### Step 5 — Read the brief

When the mission reaches a terminal state, `GET /v1/missions/{id}` returns `brief`:

```
{
  "id": "mis_...",
  "status": "completed",
  "started_at": 1736500000000,
  "ended_at": 1736500020000,
  "brief": {
    "outcome": "resolved",
    "summary_for_user": "BlueDart confirmed AWB 8821 is out for delivery, expected by 4 PM today. Rider is +1 202 555 0199.",
    "facts": {
      "tracking_number": "AWB 8821",
      "status": "Out for delivery",
      "expected_time": "4 PM today",
      "rider_contact": "+1 202 555 0199"
    },
    "next_step": "Track from 3:30 PM onward. The rider will call if anything slips.",
    "callee_role": "dispatcher",
    "confidence": 0.93,
    "evidence": [{ "quote": "Yes, out for delivery, expected by 4 PM." }]
  }
}
```

## Failure mapping (server §17)

| CALL-E / telco | Mission status | Brief outcome |
|---|---|---|
| Completed + schema filled | `completed` | `resolved` or `needs_human` (from JSON) |
| Voicemail detected | `voicemail` | `voicemail` |
| No answer / busy | `failed` | `unavailable` |
| User cancel | `canceled` | — |
| API 4xx on create | `failed` | `failed` |
| Create timed out / 5xx (call may exist) | `submission_unknown` | — (reconcile first) |
| Ambiguous transcript | `completed` | `needs_human` (do not invent facts) |

Phone-like numbers are masked (last 4 digits kept) in every response body: goals, task strings,
events, briefs and errors. The destination is always returned as a redacted E.164.

Evidence `quote` strings must be spans from the actual transcript. If you cannot point at a span,
leave the fact empty — do not hallucinate.

## Example task strings

See [examples/](examples/) for full worked examples:

- `courier.json` — BlueDart package tracking
- `clinic.json` — appointment reschedule
- `restaurant.json` — table confirmation
- `utility.json` — outage status

## Example archetype choices

| If the user says… | Use archetype |
|---|---|
| "track my package", "delivery status", "where's my order" | `courier` |
| "reschedule appointment", "doctor booking", "clinic visit" | `clinic` |
| "book a table", "restaurant reservation", "confirm order" | `restaurant` |
| "power outage", "gas leak", "water bill", "phone bill" | `utility` |
| Anything else | `general` |

## Local development

```bash
# 1. Boot the API (mock mode, loopback only; an ephemeral JWT secret is generated)
cd apps/typescript/afterhold-api
cp .env.example .env
npm install
npm run dev            # http://127.0.0.1:8787

# 2. Register a dev user and get a JWT (choose your own password)
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"<choose-a-password>","name":"Dev"}' | jq -r .access_token)

# 3. Grant consent and allowlist a fictional number
curl -X POST http://127.0.0.1:8787/v1/auth/consent \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":"v1","granted":true}'
curl -X POST http://127.0.0.1:8787/v1/numbers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"e164":"+12025550143","label":"Courier hub"}'

# 4. Create, preview, start
MID=$(curl -s -X POST http://127.0.0.1:8787/v1/missions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"e164":"+12025550143","display_name":"Courier hub","goal":"Check if AWB 8821 is out for delivery today.","archetype":"courier","region":"US"}' | jq -r .id)
curl -X POST http://127.0.0.1:8787/v1/missions/$MID/preview -H "Authorization: Bearer $TOKEN"
curl -X POST http://127.0.0.1:8787/v1/missions/$MID/start   -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 5. Wait ~20s, then read the brief
sleep 25
curl http://127.0.0.1:8787/v1/missions/$MID -H "Authorization: Bearer $TOKEN" | jq .brief
```

## Live mode

Live mode is opt-in, for operators who control the recipients. It is a hackathon-grade demo path, not
a production platform.

1. Generate a real secret: `JWT_SECRET=$(openssl rand -hex 32)`. The server refuses to boot in live
   mode, or on a non-loopback `HOST`, with an empty or public-example secret.
2. Set `CALLE_MOCK=0` and `CALLE_API_KEY=<key>`. `CALLE_BASE_URL` must be one of the approved HTTPS
   origins (`https://api.heycall-e.com`, `https://test-api.heycall-e.com`) or the server will not boot.
3. Allowlist only numbers whose owners have authorized the call (`POST /v1/numbers`).
4. Create each mission with a `region`, and send `{"confirm_live": true}` to `/start` for every run.
5. Put any non-loopback deployment behind a TLS reverse proxy.

## Limits

- Cancellation is local; it does not recall an accepted call (see above).
- One recipient per mission; no batch calls.
- Scheduling is checked in the server's local timezone (`Date#getHours`).
- Single process; SQLite by default. No outbox or distributed locks. Reconciling a
  `submission_unknown` mission is a manual step.
- Briefs are advisory. `needs_human` is the default when a result is missing or not in the enum.
- The REST API is the only integration path. There is no MCP endpoint and no SDK dependency.

## See also

- [references/result-schema.md](references/result-schema.md) — canonical envelope + per-archetype facts
- [references/task-template.md](references/task-template.md) — exact task-string format
- [references/server.md](references/server.md) — server env, cadence, kill switches
- [references/failure-mapping.md](references/failure-mapping.md) — full failure table
- [references/safety.md](references/safety.md) — safety rules
- [references/examples.md](references/examples.md) — usage examples
- [scripts/dry-run.mjs](scripts/dry-run.mjs) — local dry-run script (no live calls)
- [scripts/run-mission.mjs](scripts/run-mission.mjs) — mission runner (mock, or live with explicit confirmation)
- [examples/](examples/) — worked JSON examples
- [CALLE-AI/call-e-integrations](https://github.com/CALLE-AI/call-e-integrations) — official SDK, MCP, CLI, and skill packages
