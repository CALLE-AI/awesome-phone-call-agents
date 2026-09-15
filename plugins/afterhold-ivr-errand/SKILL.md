---
name: afterhold-ivr-errand
description: |
  Run a real outbound CALL-E call on behalf of a user, capture the conversation, and
  return a structured brief. AfterHold owns the safety layer, the workspace, and the
  mission state machine; CALL-E owns the call and the conversation runtime. This skill
  is a portable workflow: given an authorized E.164 number, a natural-language goal,
  a language, a schedule, and a result schema, build a CALL-E task, run it (or dry-run),
  poll status, and persist the brief.
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

- One outbound CALL-E call (or a queued job for `schedule_at`).
- The destination receives a phone call from CALL-E's voice runtime on behalf of the user.
- The AfterHold server stores the mission, all events, and the resulting brief.
- The CALL-E free tier is 20 calls per new account. The server enforces a 5-call-per-hour rate limit per user.

## Cancellation

The user can cancel a live mission at any time:

```
POST /v1/missions/:id/cancel
```

The mission is recorded as `canceled` regardless of whether CALL-E has finished — this is a hard
requirement, not best-effort. If CALL-E cannot be yanked mid-call, the cancel records the user's
intent and stops the local worker.

## Credentials

AfterHold API requires:

- `AFTERHOLD_API_BASE` — the base URL (e.g. `http://localhost:8787` in dev, `https://api.afterhold.app` in prod).
- `AFTERHOLD_JWT` — bearer token. Get one by calling `POST /v1/auth/login` with the user's email + password.
- `AFTERHOLD_API_KEY` is **never** used by callers. It lives only on the AfterHold server.

If `AFTERHOLD_API_BASE` or `AFTERHOLD_JWT` is missing, **stop and tell the user** rather than guessing.

## Dry-run

For local development or video demos, run the server with `CALLE_MOCK=1`. The mock adapter walks
the same phase timeline (`queued → planning → dialing → in_conversation → wrapping → completed`) with
a believable transcript and a courier-style brief, without burning a real CALL-E call. Default is
real mode (`CALLE_MOCK=0`); flip to `1` when you don't have a CALL-E account yet, or when you want to
record the demo video. See [references/server.md](references/server.md).

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
  "e164": "+914400001122",
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

1. `CALLE_ENABLED` env is `1`. If `0`, return `503`.
2. User has granted explicit consent. If not, return `412`.
3. `e164` is on the user's allowlist (skipped under `CALLE_MOCK=1`).
4. If `schedule_at` is null and we're inside quiet hours, return `429`.
5. Rate limit: ≤5 starts per user per hour. Otherwise `429`.

If all gates pass, server creates the call via CALL-E (`POST /v1/calls`) and a background worker
polls `GET /v1/calls/{id}` every `POLL_INTERVAL_SEC` (8s by default; 1.5s under `CALLE_MOCK=1`).
First poll waits `POLL_FIRST_DELAY_SEC` (60s in real, 0 in mock).

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
    "summary_for_user": "BlueDart confirmed AWB 8821 is out for delivery, expected by 4 PM today. Rider is +91 98765 43210.",
    "facts": {
      "tracking_number": "AWB 8821",
      "status": "Out for delivery",
      "expected_time": "4 PM today",
      "rider_contact": "+91 98765 43210"
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
| Ambiguous transcript | `completed` | `needs_human` (do not invent facts) |

Evidence `quote` strings must be spans from the actual transcript. If you cannot point at a span,
leave the fact empty — do not hallucinate.

## Example task strings

See [references/examples/](references/examples/) for full worked examples:

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
# 1. Boot the API
cd apps/typescript/afterhold-api
cp .env.example .env  # CALLE_MOCK=1 by default
npm install
npm run dev            # http://localhost:8787

# 2. Issue a dev JWT
TOKEN=$(curl -s -X POST http://localhost:8787/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@local","password":"dev12345","name":"Dev"}' | jq -r .access_token)

# 3. Allowlist a number + grant consent
curl -X POST http://localhost:8787/v1/auth/consent \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":"v1","granted":true}'
curl -X POST http://localhost:8787/v1/numbers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"e164":"+914400001122","label":"BlueDart"}'

# 4. Start a mission
MID=$(curl -s -X POST http://localhost:8787/v1/missions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"e164":"+914400001122","display_name":"BlueDart","goal":"Check if AWB 8821 is out for delivery today.","archetype":"courier"}' | jq -r .id)
curl -X POST http://localhost:8787/v1/missions/$MID/preview -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:8787/v1/missions/$MID/start   -H "Authorization: Bearer $TOKEN"

# 5. Wait ~20s, then read the brief
sleep 25
curl http://localhost:8787/v1/missions/$MID -H "Authorization: Bearer $TOKEN" | jq .brief
```

## Production deployment

1. Provision Postgres (or keep SQLite for low-traffic demo deployments).
2. Set `CALLE_MOCK=0` and `CALLE_API_KEY=<real key>` in `.env`.
3. Set `JWT_SECRET` to 32+ random bytes (`openssl rand -hex 32`).
4. Set `APP_ORIGIN` to the deployed iOS client's origin.
5. Run `npm run build && npm start` behind a TLS reverse proxy.
6. iOS client sets `EXPO_PUBLIC_API_BASE_URL` to the public URL at build time.
7. Demo with `CALLE_MOCK=1` until you're ready to burn free calls.

## Integration paths

AfterHold supports four ways to invoke missions, all backed by the same safety gates (consent, allowlist, quiet hours, rate limit). Pick whichever fits the caller:

### 1. REST (default, used by the iOS client)

```
POST   /v1/missions                → draft
POST   /v1/missions/:id/preview    → previewed (auto-builds the task string)
POST   /v1/missions/:id/start      → queued (places the call via CALL-E)
GET    /v1/missions/:id            → status + brief when terminal
```

### 2. MCP — Streamable HTTP (Claude Code / Codex / Cursor / Hermes)

AfterHold exposes the same surface as CALL-E's own MCP server, but every dial passes through the AfterHold safety layer. Useful when you want an AI agent to fire calls without writing bespoke REST code.

```
POST   /v1/mcp    Accept: application/json, text/event-stream
       { jsonrpc: "2.0", method: "tools/call", params: { name: "plan_call", arguments: {...} } }
```

Tools exposed:

| Tool | Purpose |
|---|---|
| `plan_call(goal, phone, archetype?)` | Draft a mission, return `plan_id`. Does NOT place a call. |
| `run_call(plan_id)` | Start the planned mission. CAN place a real call. |
| `get_call_run(run_id)` | Poll status + structured result. |
| `list_runs(filter?, limit?)` | List recent missions for the authenticated user. |

Same Bearer JWT auth as REST. External clients register via `POST /v1/auth/register`, then point their MCP client at `https://<your-host>/v1/mcp`. The MCP SDK handles the Streamable HTTP / SSE handshake automatically.

Minimal Claude Code config:

```json
{
  "mcpServers": {
    "afterhold": {
      "type": "streamable-http",
      "url": "https://api.afterhold.app/v1/mcp",
      "headers": { "Authorization": "Bearer <AFTERHOLD_JWT>" }
    }
  }
}
```

### 3. TypeScript SDK — `@call-e/calle` (server-side only)

The AfterHold backend uses the official `@call-e/calle` SDK in `src/adapters/calle.ts` instead of raw `fetch`. The adapter loads the SDK lazily (it is ESM-only) and maps the SDK's `Call` shape to our internal `CallStatusResponse`. To use it from your own backend:

```bash
npm install @call-e/calle
```

```ts
import { CalleClient } from '@call-e/calle';
const calle = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
const call = await calle.calls.create({
  task,
  resultSchema,
  recipient: { phones: [e164], locale: 'en-IN' },
});
const status = await calle.calls.get(call.id);
```

### 4. CLI — `@call-e/cli` (developer convenience)

The CALL-E CLI provides OAuth brokered login and MCP client configuration:

```bash
npm install -g @call-e/cli
calle auth login         # OAuth brokered login
calle mcp tools          # list MCP tools from the CALL-E cloud
calle mcp add afterhold  # register an MCP server entry pointing at /v1/mcp
```

The CLI is included as a devDependency in `afterhold-api` for local development; you do not need to install it separately to run the server.

### Choosing a path

| Caller | Best path |
|---|---|
| iOS / Android client | REST |
| AI agent (Claude Code, Codex, Cursor, Hermes, etc.) | MCP |
| Another backend you control | TypeScript SDK + REST |
| Local dev / one-off script | CLI + MCP, or the bundled `scripts/run-mission.mjs` |

## See also

- [references/result-schema.md](references/result-schema.md) — canonical envelope + per-archetype facts
- [references/task-template.md](references/task-template.md) — exact task-string format
- [references/server.md](references/server.md) — server env, cadence, kill switches
- [references/failure-mapping.md](references/failure-mapping.md) — full failure table
- [scripts/dry-run.mjs](scripts/dry-run.mjs) — local dry-run script (no live calls)
- [scripts/run-mission.mjs](scripts/run-mission.mjs) — full mission runner (uses live or mock)
- [examples/](examples/) — worked JSON examples
- [CALLE-AI/call-e-integrations](https://github.com/CALLE-AI/call-e-integrations) — official SDK, MCP, CLI, and skill packages
