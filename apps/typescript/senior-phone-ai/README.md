# Senior Phone AI

Senior Phone AI is a phone-native assistant designed to give older people access to realtime information, reminders and simple phone actions through an ordinary phone call. The intended live architecture uses one OpenAI Realtime agent with typed tools; CALL-E is reserved for explicitly approved outbound phone actions.

This directory contains the application scaffold and a protected developer-only OpenAI Realtime microphone harness with server-side live web search. It also contains an authorized, idempotent SMS workflow using preview/fake adapters and Supabase persistence with family-scoped row-level access controls. It does not yet connect a telephone/SMS provider or CALL-E.

## Quick start

Use Node.js 22.9 or newer.

```bash
cd apps/typescript/senior-phone-ai
npm ci
copy .env.example .env
npm run dev
```

Open <http://localhost:3000>. `SENIOR_PHONE_AI_MODE` defaults to `preview` when it is absent. The health route at `/api/health` reports that side effects are disabled.

### Live local Realtime harness

The `/realtime` page is disabled by default. To run it locally, set these server-only values in `.env`:

```dotenv
SENIOR_PHONE_AI_MODE=live
OPENAI_API_KEY=your-server-api-key
```

Start the app, open <http://127.0.0.1:3000/realtime> and choose **Start live session**. The browser will ask for microphone permission. Starting a session makes a live OpenAI request and can incur usage. Test follow-up turns, speak while the assistant is talking to verify interruption, then choose **End session** and confirm the browser microphone indicator stops.

Ask a changing question, such as the current time in a city. The Realtime agent calls the local `/api/tools/search-web` backchannel after the question, receives a bounded answer with sources and speaks the result in the same session. The page shows tool status, retrieval time, correlation ID and up to five source links. Retrieved pages are untrusted information and cannot authorize an action or change the agent's rules.

The page also shows caller and assistant transcript text in **Conversation notes** for operator review. Saving is off by default. Choose **Save notes on this device** to retain up to 10 sessions in that browser's local storage, or **Clear saved notes** to remove them. Saved notes exclude audio, system instructions and tool payloads. This local developer feature is not shared with other operators and is not a substitute for the authenticated, access-controlled dashboard planned in SPA-013.

News and local-event requests use dedicated `search_news` and `search_local_events` tools over the same protected backchannel. The tools resolve relative dates into a concrete seven-day window in the confirmed IANA timezone. Nearby-event searches require a confirmed city or suburb and ask a short clarification when context is missing. Results prioritize current official listings, include source links and availability uncertainty, and exclude listings outside the requested window. The agent gives a short spoken selection and can prepare a source-backed SMS preview on request; this developer harness does not send it.

### Local CALL-E conversation monitor

Open <http://127.0.0.1:3000/calls> in live mode. The page automatically loads the calls registered in the server-only `CALLE_MONITORED_CALL_IDS` setting and presents them in a table. Active calls refresh every two seconds, showing lifecycle status and each caller/assistant transcript turn that the provider has published. The [CALL-E Calls API](https://docs.heycall-e.com/api-reference/calls) has no list-all-calls operation, so each successful application dispatch must add its returned call ID to the durable call registry as part of SPA-010. The API documents transcript turns on an individual call response but does not promise that they are available before the terminal result.

The monitor is a local developer tool. Both `CALLE_API_KEY` and full registered call IDs stay on the server; the table shows only a shortened call identifier. The server contacts only the fixed `https://api.heycall-e.com` origin, rejects redirects, and excludes recipient numbers, task instructions, provider call IDs and raw errors from its response. Phone-like text inside transcripts and summaries is masked. Transcript text stays in browser memory and is discarded when the page closes. An authenticated shared operator view remains part of SPA-013.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run db:check
npm run check
npm run build
npm start
```

## Configuration and credentials

`.env.example` names planned server integrations and contains no usable credentials. Keep `.env.local` local; it is ignored. Values named `*_API_KEY`, `*_AUTH_TOKEN` and `SUPABASE_SECRET_KEY` are server-only and must never be exposed through `NEXT_PUBLIC_*`, client components, logs or committed fixtures. Supabase's URL and publishable key use the documented `NEXT_PUBLIC_SUPABASE_*` names; the publishable key identifies the project but RLS and verified user claims provide authorization.

Unknown runtime modes fail closed. The Realtime route requires live mode and an exact same loopback origin before it creates a rate-limited, 60-second client secret. Requests addressed through a LAN or public hostname are rejected. The long-lived OpenAI key remains on the server and the browser has no credential input. This local-only harness is not end-user authentication and must not be deployed as a public route.

The CALL-E monitor uses the same exact loopback-origin rule and a separate rate limit. It reads provider state only and cannot create, retry or cancel a call.

## Side effects and safety

The Realtime harness can stream microphone audio and run read-only live web searches only after explicit operator action. It cannot place calls, deliver SMS or schedule work. Search failures are reported instead of guessed. The SMS workflow composes sourced messages, consumes exact one-time authorization, reserves an idempotency key before dispatch, masks operational output and preserves uncertain outcomes without retrying. Its preview/fake adapters do not contact a network; Twilio delivery remains deferred to SPA-004.

The shared safety layer permits read-only tools to run automatically and requires side-effect tools to consume a one-time server authorization bound to the authenticated principal, exact action, strict E.164 destination, purpose and details. Changed, denied, expired or reused authorizations fail closed. Phone output is masked. Preview tests use process-local stores; Supabase-backed authorization and SMS stores provide durable production boundaries. No live side-effect adapter is enabled yet.

The assistant identifies itself as AI, speaks plainly, respects refusal and must not impersonate family, clinicians, therapists, emergency services or professional advisers. It does not diagnose conditions, recommend medication changes, give personalized high-risk legal/financial advice or promise emergency help. Immediate danger is directed to local emergency services or a trusted person.

## Reminder workflow

One-time reminders resolve a weekday or explicit local date/time in the senior's confirmed IANA timezone. Times from 1 through 12 require AM or PM. Past times, nonexistent spring-forward times and duplicated fall-back times return a clarification instead of guessing. Creation consumes a one-time authorization bound to the exact senior, destination, message, instant, timezone and SMS/call channel. A durable idempotency key prevents repeated tool execution from creating another reminder.

Authorized family members with reminder permission can list and cancel reminders. Cancellation changes only a pending reminder; once delivery is queued or in progress, the workflow reports that it has already started. Recurrence and actual delivery remain disabled until the host scheduler work in SPA-011.

## Cancellation and rollback

Choose **End session**, close the page or stop the server to close a local Realtime session. The SDK owns the harness microphone stream and stops its tracks on close. Choose **Clear saved notes** to remove conversation text retained by this browser. Removing the app directory removes only local source and build output; browser storage must be cleared separately.

Future provider actions must document their own cancellation limits. In particular, closing the browser or stopping this server must never be described as canceling a call already accepted by a provider. The host scheduler will own recurrence and must support disabling future runs.

## Project boundaries

| Directory | Responsibility |
|---|---|
| `app/` | Next.js pages and server route handlers |
| `lib/config/` | Server-only mode and provider configuration |
| `lib/realtime/` | Realtime session lifecycle and tool dispatch |
| `lib/tools/` | Typed information, SMS and reminder tools |
| `lib/calle/` | CALL-E outbound planning, execution and reconciliation |
| `lib/db/` | Supabase migrations and server persistence |
| `lib/safety/` | Consent, authorization, validation and redaction |
| `workflows/` | Durable post-call and scheduled orchestration |
| `tests/` | Offline deterministic tests using preview/fake adapters |

Implementation progress and acceptance criteria are tracked in [`docs/senior-phone-ai/README.md`](../../../docs/senior-phone-ai/README.md).

## Current limitations

- There is no inbound phone integration.
- There is no live SMS delivery, reminder scheduling or dashboard.
- Conversation notes are stored only in one browser and have no authentication or multi-user access controls.
- CALL-E transcript turns may not appear until a call reaches a terminal state.
- Preview adapters exercise safe interfaces only; they do not prove provider compatibility.
- The verified live browser search flow does not prove the deferred Twilio telephone gate.
