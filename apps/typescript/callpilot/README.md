# CallPilot

### AI that doesn't stop at conversation.

CallPilot turns business intent into real-world phone workflows. Instead of asking *"What can an AI say?"*, CallPilot asks **"What job can the AI complete?"**

Powered by **CALL-E**.

## What It Does

A user creates a **mission** (appointment search, quote collection, lead qualification, availability check, service coordination, follow-up). CallPilot generates an execution plan, places a **real phone call through CALL-E**, has an adaptive AI conversation, and returns **structured, actionable data** — not a transcript dump.

## Why This Problem Matters

Phone work is the last mile of business automation: clinics, vendors, and leads live behind phone numbers. Chatbots stop at text. CallPilot closes the loop: intent → planning → phone execution → adaptive conversation → structured data → action.

## How CALL-E Powers It

CALL-E is invoked **at runtime on the production path** — not simulated:

- `services/calle/calleClient.ts` is the isolated integration layer.
- It imports the official SDK `CalleClient` from `@call-e/calle` and starts calls with `client.calls.create(...)`, then tracks them honestly with `client.calls.get(callId)` snapshots.
- If the SDK shape differs, it falls back to the documented Developer API: `POST {CALLE_BASE_URL}/v1/calls` + `GET /v1/calls/{id}` with `Authorization: Bearer CALLE_API_KEY`. One-shot `calls.createAndWait` is used as a fallback path.
- The live event feed emits ONLY genuine CALL-E status transitions observed during polling — conversation facts are never invented. Demo timelines are prefixed `Simulated:` and watermarked MOCKED.
- Agent instructions (objective, questions, constraints, safety guardrails) are composed per mission and passed as the call `task`.
- Terminal output (`status`, `task_completed`, `completion_confidence`, `structured_result`, `evidence`, transcript turns) is normalized and converted by `lib/extractor.ts` into the mission result.
- Async completion is supported via `POST /api/calle/webhook` (set `CALLE_WEBHOOK_URL=https://<host>/api/calle/webhook`), with at-least-once deduplication on the `CALL-E-Event-Id` header.
- **Demo/sandbox mode** uses `MockCalleProvider` ONLY when explicitly enabled or when no API key is set, and is watermarked `MOCKED` in the UI, API payloads, and event feed. Nothing mocked is presented as a real call.

```
Task → AI Plan → CALL-E Call → Conversation → Structured Result → Action
```

## Architecture

```
callpilot/
  app/                    Next.js App Router (landing, missions/new, missions/[id], history, analytics, api/*)
  services/calle/         CALL-E abstraction (real SDK + REST fallback + labeled mock)
  agents/templates.ts     6 reusable agent templates
  lib/                    planner, extractor, validate (zod), store
  database/schema.sql     Postgres/Supabase tables (users, tasks, calls, call_events, agent_runs, call_results, templates)
  submission/             Hackathon PR pack (checklist, video script, app entry)
  types/                  Mission, ExecutionPlan, StructuredResult, events
```

The app runs without a database (file-backed store in `.data/`), and adopts Postgres/Supabase via `database/schema.sql` when `DATABASE_URL` is set.

## Main Workflow

1. Create mission → 2. Review AI plan → 3. Approve & start CALL-E call → 4. Watch live dashboard + event feed → 5. Receive structured result + AI summary + next step.

## Features

- Mission wizard with 6 templates, E.164 validation, safety modes
- AI task planner with guardrails per safety mode
- Live call dashboard: status, timeline (Preparing→…→Completed), elapsed time, events, progress
- Real-time event feed (live CALL-E status polling + terminal webhook ingestion)
- Result extraction: availability, price, requirements, notes, next action, confidence, Q&A coverage, entities
- Conversation intelligence panel, history, analytics, Developer Mode (request/config/events/output, secrets redacted)

## CALL-E Integration

- SDK: `@call-e/calle` — `CalleClient({ apiKey, baseUrl })` → `calls.create` + `calls.get` polling (`createAndWait` fallback)
- REST: `POST /v1/calls { task, recipients:[{phones}], result_schema }`, poll `GET /v1/calls/{id}`, terminal webhook `POST /api/calle/webhook`
- MCP/CLI equivalents: `plan_call → run_call → get_call_run` map to the same lifecycle; the service layer exposes the seam to swap transports.
- Docs: https://docs.heycall-e.com/ · integrations: https://github.com/CALLE-AI/call-e-integrations

## Side Effects, Dry-Run & Cancellation

Per the community contribution rules, every call-capable app must document this:

| Concern | How CallPilot handles it |
|---|---|
| Side effects | A live run places a REAL outbound phone call and speaks to a real person. Plan review is a mandatory step before dialing. |
| Dry-run / preview | Demo mode ON (default) runs the full pipeline with simulated data — no SDK call, no phone call — and every screen labels it MOCKED. The execution plan is itself a preview of what the agent will say. |
| Cancellation | Calls are one-shot (no recurrence, no schedules to cancel). Irreversible commitments are gated by safety mode: `info_only` never commits; `approval_required` must ask before booking/paying/agreeing; nothing commits silently. |
| Credentials | `CALLE_API_KEY` lives server-side in env only, never in the DB, logs, or client bundles. Developer Mode redacts it. |
| Phone numbers | Validated E.164 (`+15551234567`). No bulk dialing — one mission, one recipient. |

## Deploying

Vercel (recommended for the demo URL):

```bash
npm run build
vercel --prod   # set CALLE_API_KEY + CALLE_BASE_URL in project env vars
```

Notes:
- Live `POST /api/missions/[id]/run` long-polls CALL-E for up to ~5 minutes (`maxDuration = 300`). On Vercel Hobby (short limits), set `CALLE_WEBHOOK_URL=https://<your-app>/api/calle/webhook` so terminal results arrive async, or self-host with `npm start`.
- Without `DATABASE_URL` the app uses a local JSON store (`.data/`, gitignored) — fine for judging, not for multi-instance production. Apply `database/schema.sql` on Supabase/Postgres for durable storage.

## Local Development

```bash
cd callpilot
npm install
cp .env.example .env.local   # add CALLE_API_KEY for live calls
npm run dev                  # http://localhost:3000
```

Demo without a key: keep **Demo mode checked** — runs are labeled MOCKED.

## Environment Variables

| Var | Purpose |
|---|---|
| `CALLE_API_KEY` | Live CALL-E calls (server-side only, never exposed) |
| `CALLE_BASE_URL` | Default `https://api.heycall-e.com` |
| `DATABASE_URL` | Optional Postgres/Supabase |
| `CALLE_WEBHOOK_URL` | Optional async completion webhook |

## Running the Application

`npm run dev` / `npm run build` / `npm start`. Production path requires `CALLE_API_KEY` and demo mode OFF.

## Example Mission

TASK: "Find the earliest available appointment." → TARGET: "Example Dental Clinic" → OBJECTIVE: "Earliest appointment next week, afternoons preferred" → plan has 3 questions + 2 constraints → CALL-E dials → result: `{ availability: [{date, time}], requirements, next_action: "User approval required" }`.

## Safety

Modes: `info_only` (facts only) · `approval_required` (must ask before irreversible actions) · `autonomous` (low-risk only). The agent identifies as AI, never purchases, contracts, pays, shares sensitive data, or misrepresents identity.

## Technical Challenges

- SDK surface is young; coded SDK-first with REST fallback + normalization across naming variants (`task_completed`/`taskCompleted`, etc.).
- Long-running calls: non-blocking `beginCall` + status-change-only polling on the server, UI polling for the feed, terminal webhook for async completion.
- Honest demo: mock isolated behind an explicit flag with UI/API watermarks; live feed never invents conversation facts.

## What We Learned

Goal-driven calling (describe the outcome, let CALL-E adapt) beats scripted IVR trees; the hard part is result discipline — schema-first extraction is what makes calls actionable.

## Future Improvements

Supabase persistence + auth, multi-recipient batch missions, approval-callback mid-call, call recording links, i18n recipient locales.

## Hackathon Submission (CALL-E: Your Code Is Calling)

Contribution area: **User-facing Apps** → `apps/typescript/callpilot` in [awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents).
