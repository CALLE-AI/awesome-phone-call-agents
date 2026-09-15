# Senior Phone AI

Senior Phone AI is a local Next.js reference app for calling older Australians
with CALL-E. Before a call, the operator can equip CALL-E with one shared,
source-backed Australian daily briefing. During the conversation, the recipient
can ask about useful news, scams, digital safety, services, benefits or retirement
updates contained in that dated briefing.

After a completed call, the app can turn one clearly confirmed public-information
request into a concise sourced SMS. The [CALL-E follow-up workflow](../../../docs/senior-phone-ai/calle-followups.md)
requires an affirmative answer to an SMS permission question and rejects later
withdrawal. Preview mode performs the search and displays the exact proposed text
without contacting Twilio. The optional [Australian Twilio SMS pilot](../../../docs/senior-phone-ai/twilio-sms.md)
adds delivery and receipt tracking when explicitly enabled.

The `/calls` page contains call creation, same-day scheduling, transcripts,
summaries and the SMS record for each call in one table. The separate family,
people, reminder, settings and follow-up workspaces are outside this focused demo.
The protected `/realtime` microphone harness remains available for direct browser
experiments with OpenAI Realtime and server-side web search.

## Quick start

### Shared Australian daily knowledge

Open `/briefings` to prepare and review one dated briefing used for every senior.
No personal profile is required. The briefing uses live OpenAI web search and
stores source-backed sections for Australian news, consumer and scam alerts,
digital safety, community services, benefits and retirement information. A
section without acceptable citations remains visibly unavailable.

On `/calls`, enable **Use today's knowledge briefing** before reviewing a call.
The app prepares or reuses the current Australia/Sydney briefing and injects its
evidence into CALL-E's task. CALL-E cannot browse during the phone call; it answers
from the prepared sources and says when a requested detail was not verified.
Knowledge-enabled schedules are limited to later on the same Australian day so a
future call cannot silently reuse stale news.

Use Node.js 22.9 or newer.

```bash
cd apps/typescript/senior-phone-ai
npm ci
copy .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:3000>. `SENIOR_PHONE_AI_MODE` defaults to `preview` when it is absent. The health route at `/api/health` reports that side effects are disabled.

For the local CALL-E demo with live calls, live searches and operator-only SMS
previews, set these values in `.env.local`:

```dotenv
SENIOR_PHONE_AI_MODE=live
CALLE_API_KEY=
OPENAI_API_KEY=
CALLE_FOLLOWUP_ENABLED=true
CALLE_FOLLOWUP_PREVIEW=true
CALLE_FOLLOWUP_STORAGE_KEY=
SMS_TEST_RECIPIENTS=+614xxxxxxxx
SMS_ENABLED=false
```

Use a stable random `CALLE_FOLLOWUP_STORAGE_KEY` containing at least 32
characters. `SMS_TEST_RECIPIENTS` is a comma-separated allowlist of explicitly
consented Australian test mobiles. This mode places real CALL-E calls and runs
real OpenAI searches, but it does not contact Twilio. To test Twilio delivery,
follow the [Australian SMS setup](../../../docs/senior-phone-ai/twilio-sms.md),
turn preview off, enable SMS, and configure the Twilio account, token and sender.

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

Open <http://127.0.0.1:3000/calls> in live mode. The page automatically loads calls registered by this application, plus optional IDs from `CALLE_MONITORED_CALL_IDS`, and presents them in one table. Active calls refresh every two seconds, showing lifecycle status and each caller/assistant transcript turn that the provider has published. Each row also shows its matching SMS follow-up status and expandable message. The [CALL-E Calls API](https://docs.heycall-e.com/api-reference/calls) has no list-all-calls operation, so successful dispatches are recorded in the local durable registry. The API documents transcript turns on an individual call response but does not promise that they are available before the terminal result.

To place a call, select the country calling code and enter the local phone number on `/calls`. The app normalizes that input to strict E.164 before review. The additional instruction is optional and bounded to 300 characters; an empty value produces a general conversation. Enable daily knowledge when the call should answer from today's shared briefing. **Review call now** prepares any selected briefing and displays a masked confirmation. Only **Confirm and place call** dispatches to CALL-E. To schedule it, choose a browser-local date and time, use **Review scheduled call**, then **Confirm and schedule call**. Pending schedules appear in a table and can be canceled until dispatch starts. The local scheduler checks while the page is open and catches up at its next check after a restart. Production deployment still requires the authenticated durable scheduler work in SPA-011. Pending destination, instruction and briefing reference data are AES-GCM encrypted in an ignored, permission-restricted local registry using a key derived from the server-only CALL-E key.

For allowlisted Australian mobiles, an eligible call is automatically registered
for one post-call SMS record. CALL-E speaks a short recap, collects one complete
public-information request when needed, and asks whether the recipient wants an
SMS prepared for the same number. The local worker verifies the completed call,
request and affirmative consent before searching. It stores one sourced result or
an explicit failure state and never retries an uncertain send. In
`CALLE_FOLLOWUP_PREVIEW=true`, CALL-E uses natural customer-facing SMS language,
while the table clearly labels the result **Preview — not sent**.

Call diagnostics use newline-delimited JSON at `logs/call-activity.ndjson`. The log covers immediate and scheduled provider requests and records schedule creation, cancellation, expiration, dispatch claims, request timing, acceptance, definitive provider rejection and bounded failure codes. HTTP 4xx responses are recorded as rejected and allow a corrected, newly reviewed request to use a fresh idempotency key; uncertain transport and 5xx failures remain unknown and require same-intent reconciliation. The log masks destinations and excludes the call purpose, API key, raw provider response, provider call ID and idempotency key. The entire `logs/` directory is ignored by Git. To follow it during local testing in PowerShell, run `Get-Content logs/call-activity.ndjson -Wait` from this app directory.

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

The CALL-E page uses the same exact loopback-origin rule and separate rate limits. It can create a call only after the on-page review and explicit confirmation. It never automatically retries or cancels a call.

## Side effects and safety

The Realtime harness can stream microphone audio and run read-only live web searches only after explicit operator action. It cannot place calls, deliver SMS or schedule work. The separate local CALL-E page can place an outbound call after an operator enters the exact destination and purpose, reviews a masked preview and explicitly confirms. Search failures are reported instead of guessed. The SMS workflow composes sourced messages, consumes exact one-time authorization, reserves an idempotency key before dispatch, masks operational output and preserves uncertain outcomes without retrying. Its preview/fake adapters do not contact a network. The Twilio pilot requires separate enablement and an exact test-recipient allowlist; live verification remains part of SPA-004.

The shared safety layer permits read-only tools to run automatically and requires side-effect tools to consume a one-time server authorization bound to the authenticated principal, exact action, strict E.164 destination, purpose and details. Changed, denied, expired or reused authorizations fail closed. Phone output is masked. Preview tests use process-local stores; Supabase-backed authorization and SMS stores provide durable production boundaries. The CALL-E harness is restricted to the exact local loopback origin and is not an authenticated production endpoint.

The assistant identifies itself as AI, speaks plainly, respects refusal and must not impersonate family, clinicians, therapists, emergency services or professional advisers. It does not diagnose conditions, recommend medication changes, give personalized high-risk legal/financial advice or promise emergency help. Immediate danger is directed to local emergency services or a trusted person.

## Reminder workflow

One-time reminders resolve a weekday or explicit local date/time in the senior's confirmed IANA timezone. Times from 1 through 12 require AM or PM. Past times, nonexistent spring-forward times and duplicated fall-back times return a clarification instead of guessing. Creation consumes a one-time authorization bound to the exact senior, destination, message, instant, timezone and SMS/call channel. A durable idempotency key prevents repeated tool execution from creating another reminder.

Authorized family members with reminder permission can list and cancel reminders. Cancellation changes only a pending reminder; once delivery is queued or in progress, the workflow reports that it has already started. Recurrence and actual delivery remain disabled until the host scheduler work in SPA-011.

## Cancellation and rollback

Choose **End session**, close the page or stop the server to close a local Realtime session. The SDK owns the harness microphone stream and stops its tracks on close. Choose **Clear saved notes** to remove conversation text retained by this browser. Removing the app directory removes only local source and build output; browser storage must be cleared separately.

Closing `/calls` stops status polling but does not cancel a call accepted by CALL-E. Remove the ignored `data/calle-call-registry.json` file to clear the local call registry after any in-flight outcome has been reconciled.

An unknown scheduled-call outcome pauses the current pass and later automatic
polls. Reconcile that exact intent with CALL-E before resuming; do not create a
fresh call to work around it. This local demo has no reconciliation UI. After
provider verification, stop the server and review the matching `unknown` entry
in the ignored `data/calle-call-schedule.json` with the operator: set `status` to
`accepted` with the verified `callId`, or remove only that reconciled entry before explicitly resuming
the remaining schedules. Never clear unknown records merely to unblock dispatch.

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

## Future: two-way SMS questions

A planned extension will let a senior reply to an opted-in follow-up SMS with a
question and receive a concise answer in the same message conversation. SMS is
asynchronous, so the server-side OpenAI Responses API with web search is a better
fit for this flow than keeping an audio Realtime session open. A later telephone
handoff can use Realtime when an ongoing voice conversation is required.

The inbound flow must:

- accept only Twilio Messaging webhooks with a valid Twilio signature, and
  deduplicate retries by provider message ID;
- bind the sender to an active, explicitly consented conversation for that phone
  number, with a short expiry and no automatic enrollment from an unrelated call;
- process `STOP`, `UNSUBSCRIBE`, `HELP` and equivalent controls before sending
  text to a model;
- enforce quiet hours, message, cost and conversation-turn limits;
- search current public information on the server, include a useful source and
  date in the answer, and say when the answer cannot be verified;
- keep medical, legal, personal financial, emergency and account-changing
  requests outside the automated flow and provide an appropriate handoff; and
- record inbound questions, outbound answers and Twilio delivery status beside
  the related call in the combined history.

This capability is tracked as SPA-020 and is not implemented in the current
demo.

## Current limitations

- There is no inbound phone integration.
- The current CALL-E integration cannot invoke this app's OpenAI web-search tool
  during a provider-hosted phone call. The app therefore captures the senior's
  request and SMS permission during the call, runs the search after CALL-E marks
  the call complete, and prepares or sends the sourced answer by SMS. The shared
  daily briefing is the only searched information available inside the call.
- Live Twilio SMS delivery is unverified. CALL-E automatic follow-ups require structured request and permission evidence; preview mode can conservatively recover a confirmed public request when CALL-E splits the consent question across adjacent transcript turns. Old calls without evidence cannot trigger SMS. Scheduled CALL-E calls currently use the local operator registry; durable multi-worker Supabase scheduling remains in SPA-011.
- Conversation notes are stored only in one browser and have no authentication or multi-user access controls.
- CALL-E transcript turns may not appear until a call reaches a terminal state.
- Preview adapters exercise safe interfaces only; they do not prove provider compatibility.
- The verified live browser search flow does not prove the deferred Twilio telephone gate.
