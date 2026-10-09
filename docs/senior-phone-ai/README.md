# Senior Phone AI progress and tickets

This file is the source of truth for implementation tickets and progress. Update it as work changes; no external ticket service is required.

## Current addition: personalized morning briefings

The maintainer requested a CALL-E-only morning briefing workaround while same-call internet search remains unsupported by the public interface. The local `/briefings` workspace now supports per-senior location/timezone/interests, opt-in daily preparation, official benefits/retirement sources, evidence-backed saved call context, and health prompts from provided dates. See [morning-briefings.md](morning-briefings.md). This adapts the daily evidence/archive pattern from the maintainer's `hackthonTakeaway` project. It does not complete the original same-call search gate or enable recurring calls. Real profile enrollment, live briefing review and a separately confirmed telephone acceptance test remain pending.

## Project

Build a phone-native AI assistant for seniors: ask, search, understand, remember and act through a normal phone call. Seniors do not need an app or browser. The web interface serves authorized family members and carers.

- Stack: fullstack Next.js, TypeScript, React and Node.js, with Supabase PostgreSQL.
- Architecture: one realtime conversation agent with a small tool layer; CALL-E handles outbound phone actions.
- Branch: `feat/senior-phone-ai-app`.
- Planned app directory: `apps/typescript/senior-phone-ai/`.
- Scope: 15 MVP tickets and 5 optional extensions.
- Live information must be retrieved after the caller asks and answered during that same call. Fake providers are for explicitly labeled development/tests only.
- Host scheduling owns recurrence; the provider handles one call per scheduled run.
- Provider capabilities and deployment requirements must be verified during implementation.

## Current progress

Last updated: 2026-09-14

Implementation is in progress. MVP: **13/15 done**. Optional extensions: **0/5 done**.

Current ticket: [SPA-015](#spa-015). Deployment, demo and PR materials are prepared; hosted migration verification and approved live browser evidence remain. The Twilio voice/SMS gate remains [SPA-004](#spa-004). The [CALL-E post-call workflow](calle-followups.md) now collects request/permission evidence, waits for completion, searches and sends one Twilio SMS. The `/followups` UI uses the CALL-E monitor. Live extraction and carrier verification remain unfinished.

Read [submission review findings](review-notes.md) before implementation. The review informed the acceptance criteria below, including runtime grouping, early endpoint protection and public-artifact privacy checks.

The final MVP gate is [SPA-004](#spa-004): connect Twilio/inbound SIP only after the application, safety, resilience and deployment work is ready, then prove that a real telephone caller can ask an unscripted question, trigger external search, and hear the retrieved answer in the same call.

## How to maintain this tracker

1. Keep ticket IDs stable. Add new tickets with the next unused ID; do not renumber existing tickets.
2. The board is the authoritative status list. Use **Backlog**, **Ready**, **In progress**, **Blocked**, **Done**, or **Canceled**. Optional work starts in Backlog.
3. Start a ticket only after its dependencies are Done. Move eligible MVP work to Ready and the active ticket to In progress.
4. Tick acceptance criteria as they are verified. Record implementation notes, commands/results and relevant file or commit links under the ticket.
5. Use Blocked for an actual impediment and record the reason and next action. An unfinished dependency alone leaves a ticket in Backlog.
6. Mark Done only after all acceptance criteria and applicable checks pass. Record live checks separately; a fake-provider test does not prove live telephone behavior.
7. Update the board, progress counts, next ticket, last-updated date and progress log in the same change. Reopen a ticket if a completed criterion regresses.
8. Keep logs concise and redact personal information. Do not record credentials or real phone numbers. Confirm live call/SMS side effects before execution.

## Milestones

| Milestone | Tickets | Completion condition |
|---|---|---|
| M1: Prove realtime browser tool calling | SPA-001–SPA-003 | Realtime browser search gate passes with redacted evidence |
| M2: Build the core MVP | SPA-005–SPA-013 | SMS, persistence, reminders, CALL-E and authorized dashboard work end to end |
| M3: Verify, demonstrate and connect the MVP | SPA-014–SPA-015, then SPA-004 | Required checks, the browser demo and the authorized live telephone gate pass; operations are documented |
| M4: Optional extensions | SPA-016–SPA-020 | Selected extensions meet their own acceptance criteria after the MVP |

## Ticket board

| ID | Ticket | Milestone | Priority | Status | Depends on |
|---|---|---|---|---|---|
| [SPA-001](#spa-001) | Scaffold the fullstack Next.js TypeScript app | M1 | High | Done | None |
| [SPA-002](#spa-002) | Prove local realtime audio conversation and session lifecycle | M1 | High | Done | [SPA-001](#spa-001) |
| [SPA-003](#spa-003) | Add live web search to the ongoing realtime conversation | M1 | High | Done | [SPA-002](#spa-002) |
| [SPA-005](#spa-005) | Enforce tool permissions and senior conversation safety | M2 | Medium | Done | [SPA-003](#spa-003) |
| [SPA-006](#spa-006) | Prepare authorized information SMS during the call workflow | M2 | Medium | Done | [SPA-005](#spa-005) |
| [SPA-007](#spa-007) | Add Supabase persistence, family authentication and data access controls | M2 | Medium | Done | [SPA-006](#spa-006) |
| [SPA-008](#spa-008) | Add live news and local-event discovery | M2 | Medium | Done | [SPA-007](#spa-007) |
| [SPA-009](#spa-009) | Create, list and cancel confirmed reminders with timezone handling | M2 | Medium | Done | [SPA-007](#spa-007) |
| [SPA-010](#spa-010) | Integrate CALL-E outbound planning, execution and result tracking | M2 | Medium | Done | [SPA-007](#spa-007) |
| [SPA-011](#spa-011) | Schedule durable reminder delivery through SMS and CALL-E | M2 | Medium | Done | [SPA-009](#spa-009), [SPA-010](#spa-010) |
| [SPA-012](#spa-012) | Create opt-in post-call summaries and SMS follow-up | M2 | Medium | Done | [SPA-007](#spa-007), [SPA-009](#spa-009) |
| [SPA-013](#spa-013) | Build the minimal authorized family and carer dashboard | M2 | Medium | Done | [SPA-008](#spa-008), [SPA-011](#spa-011), [SPA-012](#spa-012) |
| [SPA-014](#spa-014) | Verify resilience, privacy and end-to-end workflow behavior | M3 | Medium | Done | [SPA-013](#spa-013) |
| [SPA-015](#spa-015) | Document deployment and run the polished Margaret MVP demo | M3 | Medium | In progress | [SPA-014](#spa-014) |
| [SPA-004](#spa-004) | Connect Twilio inbound SIP and SMS and pass the live phone gate | M3 | High | Backlog | [SPA-015](#spa-015) |
| [SPA-016](#spa-016) | Optional: call a venue on the senior's behalf and return the result | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-017](#spa-017) | Optional: contact trusted family on explicit senior request | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-018](#spa-018) | Optional: add weather and government-information tools | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-019](#spa-019) | Optional: add explicitly scheduled recurring check-ins | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-020](#spa-020) | Optional: add consented two-way SMS questions | M4 | Low | Backlog | [SPA-004](#spa-004) |

## Ticket details

### SPA-001

**Scaffold the fullstack Next.js TypeScript app**

Create apps/typescript/senior-phone-ai/ with Next.js App Router, React, TypeScript and Node.js server code. Keep one application where practical; no separate FastAPI backend.
Acceptance criteria:
- [x] Development, production build, lint and typecheck commands work.
- [x] A clean install and production start follow the documented commands; environment names match configuration. Keep dependencies, lockfile and configuration scoped to this app.
- [x] Server-only provider configuration validates required environment variables; .env.example contains placeholders only.
- [x] lib/realtime, lib/tools, lib/calle, lib/db, lib/safety and workflows have clear boundaries.
- [x] Default development/tests use explicit fake or dry-run adapters and cannot place real calls or send SMS.
- [x] Include focused setup documentation and comply with repository validation.

Implementation notes and verification: Added the Next.js 16 App Router scaffold under `apps/typescript/senior-phone-ai/`, server-only configuration guards, typed preview SMS/CALL-E adapters, boundary documentation, a responsive preview page and `/api/health`. `npm ci`, `npm run check`, `npm run build`, production startup and HTTP checks for `/` and `/api/health` passed. Three offline tests passed. `npm audit` reported zero vulnerabilities after pinning patched `esbuild` 0.28.1. `python scripts/validate_repository.py` and `git diff --check` passed. Generated `node_modules/` and `.next/` were removed after verification and can be recreated with `npm ci` and `npm run build`.

### SPA-002

**Prove local realtime audio conversation and session lifecycle**

Build a developer-only microphone/audio harness using one OpenAI Realtime agent.
Acceptance criteria:
- [x] Verify current official API/session requirements before implementation and document chosen transport/model.
- [x] User speech produces streaming spoken responses in the same session; interruptions and follow-up questions work.
- [x] Server credentials stay server-side; any client session credentials are short-lived.
- [x] Protect remotely reachable session creation before exposure; reject unauthorized spending requests and cross-origin browser mutations. Keep the harness private until protection is verified.
- [x] AI identity is disclosed and session end/disconnect releases resources.
- [x] Measure session establishment and response latency; report real results without invented targets.

Implementation notes and verification: Added a developer-only `/realtime` microphone harness using the official OpenAI Agents SDK, `gpt-realtime-2.1` and browser WebRTC. The server creates 60-second client secrets only in live mode after enforcing an exact same loopback origin and a developer rate limit; LAN and public hostnames are rejected, the development command binds to `127.0.0.1`, and the browser never receives the long-lived API key or displays a credential input. The SDK session uses semantic VAD, automatic interruption, AI identity/safety instructions, explicit mute/interrupt/end controls, unload cleanup, a 15-minute maximum and no transcript/audio persistence. A credentialed local browser test completed 10 conversation items over four measured spoken turns, including follow-up interaction, then ended and released the session. Observed request-to-connection latency was 3,665 ms. Observed speech-stop-to-first-audio latency was 610 ms, 690 ms, 1,050 ms and 691 ms; these are local observations, not targets. The user confirmed the live audio behavior worked. Eight offline tests, lint and typecheck passed after the final WebRTC measurement adjustment. No API key, audio or transcript was recorded in repository files.

### SPA-003

**Add live web search to the ongoing realtime conversation**

Implement a typed searchWeb tool and dispatcher that returns results into the ongoing audio session.
Acceptance criteria:
- [x] An unscripted spoken question triggers external search after the question; the answer is spoken before the session ends.
- [x] Return source URLs, retrieval times and bounded result text; keep retrieved content untrusted and prevent it from authorizing actions.
- [x] Validate tool arguments and correlate tool calls/results; handle timeout, failure and interruption honestly.
- [x] No pre-fetched news, hardcoded answers or post-call answers masquerading as realtime.
- [x] Fake-provider tests verify dispatch and result correlation; explicitly enabled live testing proves actual search.

Implementation notes and verification: Added a typed `search_web` function tool to the existing Realtime agent. It calls a loopback-only server backchannel after the caller's question, validates bounded input and a UUID v4 correlation ID, runs the OpenAI Responses web search tool with a 25-second provider timeout, and returns bounded plain text, retrieval time and up to five safe HTTP(S) sources. Final-answer URL citations take precedence over broader discovery URLs. Retrieved content is explicitly untrusted and cannot authorize actions. The browser displays searching/completed/failed state and returns an honest failure result to the ongoing voice session. Recoverable SDK errors preserve a connected session and expose only a bounded diagnostic code; disconnected sessions still release resources.

The explicitly enabled live browser check passed with an unscripted spoken location/news question: search ran after speech, completed at 2026-09-10 19:45:18 Australia/Sydney under redacted correlation `f04c…d71d`, and returned an answer plus five source URLs into the same six-item conversation before the session ended. The server observed an 18.2-second search request, while the browser observed 4,007 ms session establishment and 429 ms from speech stop to first audio on the measured turn. A separate focused live request after the citation-priority fix completed in 14,086 ms with a matching correlation ID, five official City of Sydney URLs and a 73-character bounded answer. A live retry failure at 18,513 ms also exercised the honest 502 path without reusing prior data. Thirteen offline tests, lint and typecheck pass.

### SPA-004

**Connect Twilio inbound SIP and SMS and pass the live phone gate**

Connect a normal telephone number through Twilio SIP trunking and add the live Twilio SMS adapter as the final MVP ticket.
Acceptance criteria:
- [ ] Verify supported provider/OpenAI integration and hosting requirements against current official documentation; record capability gaps.
- [ ] Authenticate inbound events, deduplicate delivery, manage call/session teardown and secure the server-side tool-control channel.
- [ ] Verify authentication against the actual transport contract. Public call/log/transcript routes are forbidden; an unsigned notification is never trusted as an authoritative result.
- [ ] A real caller asks a previously unknown question, external search starts afterward, and the retrieved answer is heard during that same phone call.
- [ ] A confirmed information message is delivered by Twilio during the call; authenticate and deduplicate its delivery callback.
- [ ] Record redacted timestamps/correlation evidence and observed latency; exercise follow-up and interruption.
- [ ] Live checks require explicit consent and configured test numbers. Run this gate only after SPA-015 passes.
- [ ] Keep CALL-E for outbound actions; do not assume CALL-E inbound live tool calling.

Implementation notes and verification: Deferred to the final MVP ticket. No Twilio or inbound SIP implementation is active.

### SPA-005

**Enforce tool permissions and senior conversation safety**

Implement shared safety and consent checks before exposing side-effect tools.
Acceptance criteria:
- [x] Read-only tools may run automatically; external actions require explicit intent with recipient, purpose and relevant details confirmed.
- [x] Consent is bound to the specific action and cannot be fabricated by search results or provider output.
- [x] Persist exact destination and purpose authorization server-side; changed parameters invalidate approval. A confirmation phrase is not endpoint authentication. Require strict ASCII E.164 at dispatch.
- [x] Validate E.164 numbers; mask numbers in summaries/logs and keep credentials and sensitive authentication data out of prompts and UI.
- [x] Disclose AI identity, support gentle conversation without impersonating family, clinicians, therapists or emergency services.
- [x] No diagnosis, medication changes, personalized high-risk legal/financial advice or emergency guarantees; direct urgent needs toward appropriate human channels.
- [x] Bookings/purchases remain outside the MVP. Test denied, expired/mismatched and confirmed action paths.

Implementation notes and verification: Added an SDK-independent safety layer that permits only registered read-only tools to run automatically. Future SMS, reminder, trusted-contact and outbound-call adapters must consume a one-time server authorization bound to the authenticated principal, exact action, strict ASCII E.164 destination, purpose and bounded non-credential details. The process-local development store masks confirmation output and fails closed for missing confirmation, refusal, expiry, principal or parameter mismatch and reuse; SPA-007 will implement its interface with durable authenticated storage before live side effects. Added phone-like text redaction, structured conversation boundaries and stronger Realtime instructions for identity disclosure, patient clarification, refusal, action confirmation, urgent human help and prohibited professional/booking behavior. Twenty offline tests, lint and typecheck pass. The official Agents SDK tool and voice-agent guidance was verified on 2026-09-10; application authorization remains mandatory inside side-effect execution.

### SPA-006

**Prepare authorized information SMS during the call workflow**

Implement the provider-neutral sendSms workflow with preview and fake adapters. Live Twilio delivery remains in SPA-004.
Acceptance criteria:
- [x] A request such as 'send me the details' prepares a concise, scannable message for a confirmed destination during the active workflow.
- [x] Information includes relevant event time/address/source link without invented details.
- [x] Third-party recipients require explicit confirmation; validate E.164 and mask numbers in operational output.
- [x] Return previewed/queued/sent/failed/unknown states accurately, require verified delivery callbacks and deduplicate sends.
- [x] Include dry-run preview and fake-provider tests; no provider request is made by default. Live Twilio delivery is deferred to SPA-004.
- [x] Provide a storage interface that the Supabase persistence ticket will implement.

Implementation notes and verification: Added a provider-neutral SMS service that composes bounded source-backed event messages, consumes the exact one-time SPA-005 authorization and reserves an idempotency key before adapter dispatch. Operational results expose only a safe correlation ID, masked destination and honest previewed/queued/sent/failed/unknown state. Exact duplicate requests reuse the stored result; changed requests fail closed, and uncertain provider results remain unknown without automatic retry. The storage interface accepts verified delivery events, deduplicates event IDs and prevents older callbacks from regressing newer state. Preview and fake adapters make no network request. Twenty-six offline tests, lint, typecheck and the production build pass. Live Twilio sending and provider-specific signature verification remain explicitly assigned to final ticket SPA-004.

### SPA-007

**Add Supabase persistence, family authentication and data access controls**

Add Supabase PostgreSQL migrations and server data access for seniors, trusted contacts, preferences, calls, optional transcripts, summaries, tool activity, SMS, reminders and scheduled check-ins.
Acceptance criteria:
- [x] Store timezone, approximate location and interests; use a synthetic Margaret fixture with no real phone number.
- [x] Family/carer authentication and membership authorization restrict each user's senior records; verify cross-account access denial and RLS.
- [x] Caller ID alone is not sufficient authorization to expose private data; define a low-friction safe enrollment/verification flow.
- [x] Persist SMS history and tool/call correlation without credentials; keep service credentials server-only.
- [x] Define senior-approved sharing, minimal collection, retention/deletion and optional recording/transcript consent before enabling storage.
- [x] Migrations and seeds run in embedded PostgreSQL without Docker; exercise RLS locally and document hosted deployment, rollback and schema relationships.

Implementation notes and verification: Added a Supabase PostgreSQL schema for senior profiles, active family/carer memberships, sharing preferences, trusted contacts, correlated calls/tools/SMS, one-time action authorization, delivery events, reminders and scheduled work. RLS allows only active members to read a senior and requires an additional content permission for calls, transcripts and tool activity. Supabase SSR clients derive identity from verified claims; caller ID and caller-supplied identifiers never authorize private access. Durable action/SMS adapters preserve exact-action authorization and idempotent callback handling, while the secret-key client is isolated to server-only modules. Transcript and summary storage default off and database triggers require current consent. A retention function deletes or clears time-limited sensitive content.

The number-free Margaret seed stores only timezone, approximate location and interests. Enrollment is documented as a short-lived hashed invite accepted by a matching authenticated Supabase user after senior-approved sharing. A fresh in-memory PGlite PostgreSQL instance applied the migration and seed without Docker, enforced summary consent, allowed the synthetic family member, denied an unrelated account and verified restricted grants. Thirty-one offline tests, lint, typecheck, production build and repository validation passed. Hosted Supabase application and verification are assigned to SPA-015's deployment gate.

### SPA-008

**Add live news and local-event discovery**

Implement searchNews and searchLocalEvents with the existing live tool dispatcher.
Acceptance criteria:
- [x] Search after each live request; prioritize useful current sources, local councils, libraries and community listings.
- [x] Resolve 'this week' and 'nearby' using confirmed location and timezone; ask when location is missing.
- [x] Return event dates, venue, address, availability uncertainty and sources, filtering stale/irrelevant results.
- [x] Give short spoken answers and offer requested SMS through the existing tool.
- [x] Never present the sample gardening workshop as a verified real event.
- [x] Cover empty results, stale listings, tool errors and follow-up questions.

Implementation notes and verification: Added dedicated Realtime `search_news` and `search_local_events` tools over the protected SPA-003 search backchannel. A deterministic discovery layer validates bounded queries and IANA timezones, requires confirmed city/suburb context for nearby events, resolves relative requests into an explicit local seven-day window, and instructs live retrieval to prefer current official council, library, venue and community sources. Event results request no more than three useful options with dates, venue, address, source and honest availability uncertainty; missing context returns a one-question clarification. The existing information-SMS composer is exposed as a requested preview only and cannot send or bypass authenticated destination confirmation.

Updated the search route to the current lower-cost `gpt-5.6-luna` model with web search support, no reasoning allocation and enough output space for complete event details. Incomplete or empty responses fail honestly, and diagnostics retain only a bounded error code. A live news request completed at 2026-09-10T12:35:57Z under redacted correlation `4600…0006` with five sources. A live Sydney event request completed at 2026-09-10T12:40:44Z under redacted correlation `4c00…000c`, returning three dated official-source options with venue/address and confirmation caveats. Earlier provider failures exercised the 502 path without reusing results. Thirty-six offline tests, lint, typecheck, production build and repository validation passed.

### SPA-009

**Create, list and cancel confirmed reminders with timezone handling**

Implement createReminder, listReminders and cancelReminder with durable state.
Acceptance criteria:
- [x] Resolve natural-language dates in the senior's IANA timezone; clarify ambiguous 'Friday at 10', AM/PM and DST cases.
- [x] Confirm exact date/time, message and SMS/call channel before saving.
- [x] Persist consent, action identity and lifecycle state; repeated tool execution does not create duplicates.
- [x] Allow authorized listing/cancellation and explain whether a delivery has already started.
- [x] One-time reminders are the MVP; recurrence must never be silently inferred.
- [x] Test ambiguous dates, past dates, DST, repeated requests and cancellation races.

Implementation notes and verification: Added a deterministic reminder-time resolver for weekday and explicit local date/time phrases. It uses the senior's IANA timezone, asks for AM/PM for ambiguous 1–12 hour values, advances elapsed same-day weekday requests to the following week, rejects past instants, and detects both nonexistent and duplicated daylight-saving local times without guessing. The reminder service consumes the exact one-time SPA-005 authorization bound to senior, principal, strict E.164 destination, message, resolved UTC instant, timezone and SMS/call channel. It reserves durable idempotency before consumption so repeated tool execution returns the original row.

Added in-memory and Supabase reminder stores with authorized list/cancel operations. The Supabase adapter requires an active membership with reminder-management permission. Cancellation atomically changes only pending rows; queued, in-progress or completed work reports `already_started`, while repeated cancellation reports `not_found`. The schema persists action identity, principal, destination, lifecycle status and cancellation time. Recurrence and delivery are intentionally left to SPA-011. Forty-three offline tests, lint, typecheck, production build and repository validation passed.

### SPA-010

**Integrate CALL-E outbound planning, execution and result tracking**

Wrap CALL-E MCP behind planOutboundCall, executeOutboundCall and getOutboundCallResult.
Acceptance criteria:
- [x] Verify current plan_call/run_call/get_call_run schemas and limitations before implementation; do not assume MCP and REST parity.
- [x] Restrict credential-bearing requests to verified provider origins, reject credential-leaking redirects and keep fake adapters isolated from production keys. Do not interpolate tool input into shell commands.
- [x] Dispatch only an explicitly confirmed action to a validated E.164 destination; persist provider IDs and action identity.
- [x] Validate structured results and treat provider content as untrusted.
- [x] Handle pending, completed, no-answer, voicemail, failure and unknown dispatch outcomes.
- [x] Never blindly retry an uncertain dispatch; reconcile first and expose unresolved status.
- [x] Persist the intent before submission and retain the uncertainty hold across restarts, concurrent workers and new sessions; a process-local deduplication map is insufficient.
- [x] Explain cancellation limits honestly, particularly once a call is in flight.
- [x] Include a local fake server/dry-run adapter; no default real outbound calls.

Implementation notes and verification: The local-only `/calls` operator page accepts an E.164 destination and optional bounded purpose, shows a masked no-side-effect review, and dispatches only after a separate explicit confirmation. A local ignored registry persists an intent fingerprint before dispatch, records accepted provider IDs, blocks uncertain retries, and now uses an atomic permission-restricted file lock across local workers and restarts. Calls appear automatically in a table with redacted transcript and summary text. Published lifecycle states map to coarse pending, completed, incomplete, failed, canceled and unknown outcomes. Because CALL-E does not publish stable no-answer or voicemail enums, the app keeps those cases incomplete unless the bounded provider summary supplies context; it never branches on opaque failure strings. The fixed-origin offline fake provider exercises queued and terminal snapshots without credentials or network access. MCP and REST limitations and sources are recorded in [calle-integration.md](calle-integration.md). Seventy-one offline tests, lint, typecheck, the production build and repository validation pass.

### SPA-011

**Schedule durable reminder delivery through SMS and CALL-E**

Connect confirmed reminders to a durable host scheduler and one-time provider dispatch.
Acceptance criteria:
- [x] Host scheduler owns recurrence; each scheduled run invokes exactly one call per intended call delivery.
- [x] Atomically claim due work and use durable idempotency to prevent duplicate jobs/calls across retries or concurrent workers.
- [x] Honor timezone, consent, cancellation, channel preferences and a documented late-run policy.
- [x] Support SMS and CALL-E reminder delivery with accurate status recording.
- [x] Reconcile uncertain dispatch instead of retrying blindly; bounded safe retries cover known retryable failures.
- [x] Disabling/canceling stops future dispatch; already in-flight actions are described accurately.
- [x] Test scheduler restart, duplicate execution, cancellation race and provider failure without live calls.

Implementation notes and verification: The local operator supports one-time CALL-E scheduling with browser-local time selection, masked review, separate confirmation, encrypted persistence, pending visibility and pre-dispatch cancellation. An exact server-only Bearer secret protects host scheduler runs. The provider-neutral reminder scheduler requires a current channel-preference policy, routes confirmed SMS and CALL-E deliveries, retries only explicit definite failures twice, and retains uncertain dispatch as `unknown`. It expires work more than 15 minutes late. Supabase reminder insertion enqueues one delivery automatically; service-role-only functions claim due rows with `FOR UPDATE SKIP LOCKED` and atomically finish both delivery and reminder records. Offline tests cover concurrent and restarted schedulers, duplicate prevention, cancellation, IANA timezones, preferences, late work, channel routing, bounded failure retries and uncertainty. Live Twilio SMS remains in final ticket SPA-004.

### SPA-012

**Create opt-in post-call summaries and SMS follow-up**

Generate a brief summary from actual conversation/tool outcomes after a call.
Acceptance criteria:
- [x] Include only grounded information and saved/confirmed actions; distinguish failed or pending actions.
- [x] Send concise SMS only when opted in, with a confirmed recipient and minimal sensitive content.
- [x] Deduplicate finalization and summary delivery across repeated call-end events.
- [x] Persist summaries and delivery outcomes with access controls and retention policy.
- [x] Handle incomplete/disconnected calls and failed SMS honestly.

Implementation notes and verification: The post-call finalizer accepts terminal CALL-E snapshots, masks phone numbers, labels saved actions by outcome and uses an explicit fallback when no reliable summary exists. Summary storage requires the senior's active sharing consent. Supabase persistence uses family-member row-level security, deletes finalization data when call-summary retention clears it, and reserves SMS delivery atomically so concurrent call-end workers cannot send duplicates. SMS requires explicit opt-in, strict E.164, the exact confirmed message and the existing authorization service; provider uncertainty is stored as `unknown` without automatic retry. See [post-call summaries and follow-up](post-call-summaries.md). Live Twilio delivery remains in SPA-004.

### SPA-013

**Build the minimal authorized family and carer dashboard**

Implement /dashboard, /seniors, /seniors/[id], /calls, /reminders and /settings in Next.js.
Acceptance criteria:
- [x] Authorized carers see relevant senior profiles, trusted contacts, recent calls, confirmed actions, reminder states and SMS delivery.
- [x] Last successful check-in reflects an actual recorded event, never an inferred wellness assessment.
- [x] Support approved profile/preferences and reminder management using the same permission checks as voice workflows.
- [x] Show loading, empty, error and pending states; mask phone numbers where appropriate and use accessible responsive controls.
- [x] Do not show loneliness, psychological or medical risk scores.
- [x] Verify cross-account access denial through both pages and server endpoints.
- [x] Render provider-controlled results/errors as text and redact nested phone/contact/transcript content before public output; cover formatted and local-number forms as well as E.164.

Implementation notes and verification: The authenticated family workspace adds dashboard, senior, reminder and settings routes backed by verified Supabase sessions and row-level security. It shows authorized profiles, masked contacts, recorded call outcomes, confirmed actions, reminder and SMS states, with explicit loading, empty, error and pending UI. Owners can manage approved profile/consent settings and reminder managers can cancel pending reminders through same-origin endpoints whose database functions re-check `auth.uid()` permissions. Embedded PostgreSQL tests prove an unrelated account cannot invoke these functions. Shared text redaction covers E.164, formatted, nested and local phone numbers. The existing `/calls` page remains the loopback live operator view; retained call data appears in the private dashboard. See [family and carer dashboard](family-dashboard.md).

### SPA-014

**Verify resilience, privacy and end-to-end workflow behavior**

Add focused automated integration tests for the complete MVP using fake providers by default.
Acceptance criteria:
- [x] Cover duplicate/out-of-order webhooks, tool/API timeouts, disconnected realtime sessions and malformed CALL-E results.
- [x] Cover no answer, voicemail, SMS failure, scheduler retries and unknown dispatch without duplicate calls.
- [x] Test explicit consent, action authorization, E.164 validation, redaction and cross-account data isolation.
- [x] Capture safe correlation IDs and latency/outcome metrics; never log credentials or full sensitive transcripts by default.
- [x] Run typecheck, lint, production build, app tests and python scripts/validate_repository.py.
- [x] Verify clean install and production startup, unauthorized endpoint access, destination substitution, credential-origin rejection, untrusted HTML rendering and uncertainty recovery after restart.
- [x] Document residual risks and manual live checks separately from deterministic tests.

Implementation notes and verification: The deterministic suite now covers malformed and provider-controlled content, disconnected realtime state, HTML escaping and a strict safe-event schema in addition to the existing webhook ordering, timeout, authorization, consent, RLS, scheduler and uncertainty tests. Safe events contain only a validated correlation ID, bounded latency, coarse outcome, masked destination and bounded diagnostic code. A clean dependency install, production build/startup, signed-out page/API probes and repository validation pass without placing a call or sending an SMS. Manual provider checks and residual uncertainty behavior are recorded in [MVP verification and residual risks](verification.md).

### SPA-015

**Document deployment and run the polished Margaret MVP demo**

Prepare operating documentation and a reproducible end-to-end demo.
Acceptance criteria:
- [ ] Document Next.js/Node hosting, apply and verify migrations against the configured hosted Supabase project, scheduler, secrets and non-SIP provider configuration; leave Twilio/SIP setup for SPA-004.
- [x] Document side effects, consent, cancellation/disable behavior, rollback, retention and troubleshooting.
- [ ] Demonstrate browser realtime conversation → arbitrary live news/search → current local event → requested SMS → confirmed reminder → CALL-E reminder delivery → dashboard state.
- [ ] Use current retrieved events; no hardcoded demo answers. Clearly label offline fake mode.
- [ ] Run live SMS only with explicit test consent and configured recipients; collect redacted evidence of same-session browser search. The live telephone proof belongs to SPA-004.
- [x] Keep optional call-on-behalf outside the required MVP acceptance.
- [x] Prepare repository-facing documentation in English under apps/typescript/senior-phone-ai/ and docs/ as appropriate.
- [x] Review the full PR diff, relevant history, screenshots, video and linked public artifacts for credentials and personal data. Use number-free synthetic fixtures where possible; any full example number must be verified reserved fiction and rejected by live dispatch.
- [x] Add a factual app catalog entry, complete the PR template, and keep the title/body aligned with the actual scoped contribution. Make no clinical or production-readiness claims without evidence.

Implementation notes and verification: Added a no-Docker Node/Next.js deployment guide covering server-only secrets, ordered hosted Supabase migrations, RLS checks, scheduler architecture, disable/rollback behavior, retention and troubleshooting. Added separate offline and approved-live Margaret demo steps, with current retrieval required and explicit redaction/evidence cleanup. Added root and app catalog entries plus a PR draft aligned to `feat(apps): add Senior Phone AI`. Hosted migration application, live browser search evidence and any consented provider action remain intentionally unclaimed. See [deployment](deployment.md), [demo runbook](demo-runbook.md) and [pull request draft](pull-request.md).

### SPA-016

**Optional: call a venue on the senior's behalf and return the result**

Add the confirmed call-on-behalf workflow using the existing CALL-E adapter.
Acceptance criteria:
- [ ] Confirm the discovered target number, limited purpose and permission before dispatch.
- [ ] Tell the senior when the result will arrive asynchronously; send the verified outcome by approved SMS or callback.
- [ ] Track pending/failed/completed states; validate results before any consequential follow-up.
- [ ] No booking, purchase or expanded action without new explicit permission.
- [ ] Reuse idempotency, unknown-dispatch handling and cancellation limits; test against fake providers.

Implementation notes and verification: Not started.

### SPA-017

**Optional: contact trusted family on explicit senior request**

Allow a senior to ask an approved trusted contact to call them.
Acceptance criteria:
- [ ] Resolve and confirm the trusted recipient, message and channel; require senior authorization.
- [ ] Record the request, dispatch once and report actual delivery status.
- [ ] Never initiate outreach solely from inferred loneliness or medical/psychological scoring.
- [ ] Respect approved sharing, contact revocation, minimal data and cancellation limits.
- [ ] Test unauthorized recipients, duplicate requests and failed delivery.

Implementation notes and verification: Not started.

### SPA-018

**Optional: add weather and government-information tools**

Add getWeather and searchGovernmentInformation through the same typed read-only dispatcher.
Acceptance criteria:
- [ ] Use current verified providers/official sources with retrieval time and location context.
- [ ] Answer within the ongoing call and offer concise SMS when requested.
- [ ] Distinguish general information from individualized high-stakes advice and eligibility determinations.
- [ ] Handle outdated, conflicting or missing results honestly; test failure paths.

Implementation notes and verification: Not started.

### SPA-019

**Optional: add explicitly scheduled recurring check-ins**

Extend the host scheduler to opt-in recurring check-ins after one-time reminders are reliable.
Acceptance criteria:
- [ ] Confirm frequency, timezone, time window, recipient and channel; show the next occurrence.
- [ ] Host owns recurrence and sends one provider call per run with durable duplicate prevention.
- [ ] Allow listing, pausing, canceling and disabling all future runs.
- [ ] Respect preferences and documented late-run behavior; never create hidden schedules.
- [ ] Record only objective contact outcomes, without inferred health or loneliness scores.

Implementation notes and verification: Not started.

### SPA-020

**Optional: add consented two-way SMS questions**

Let a senior reply to an opted-in follow-up SMS, search current public
information with OpenAI on the server and return a concise answer in the same
SMS conversation.

Acceptance criteria:
- [ ] Validate Twilio Messaging webhook signatures and deduplicate provider retries by message ID.
- [ ] Bind each sender to an active, explicitly consented phone-number conversation with a documented expiry.
- [ ] Process `STOP`, `UNSUBSCRIBE`, `HELP` and equivalent controls before any model request.
- [ ] Use server-side OpenAI web search, include a useful source and retrieval date, and state when information cannot be verified.
- [ ] Enforce quiet hours, message, cost and conversation-turn limits without creating a hidden recurring job.
- [ ] Decline or hand off medical, legal, personal financial, emergency and account-changing requests.
- [ ] Show inbound questions, outbound answers and Twilio delivery status beside the related call in the combined history.
- [ ] Test signature failure, duplicate delivery, expired consent, opt-out, search failure and provider failure with synthetic data and no live side effects.

Implementation notes and verification: Not started. Use the Responses API with
web search for asynchronous SMS; reserve Realtime for a later live voice
handoff.

## Progress log

| Date | Tickets | Update | Verification |
|---|---|---|---|
| 2026-09-14 | SPA-020 | Scoped a future consented two-way SMS question flow with current public-information search, source-aware replies, opt-out handling and bounded conversation history. | Documentation-only change; the capability remains Backlog and no SMS was sent. |
| 2026-09-11 | SPA-015 foundation | Prepared no-Docker deployment, rollback, scheduler and Margaret demo runbooks; added catalog entries and a scoped PR draft. SPA-015 is In progress pending hosted migration verification and approved live evidence. | Documentation and public artifacts are being validated without reading `.env.local` or invoking a provider. |
| 2026-09-11 | SPA-014 | Added safe workflow outcome metrics and focused malformed-provider, disconnected-session and untrusted-rendering tests; documented residual risks and made SPA-015 Ready. | Ninety-one offline tests, lint and typecheck passed. Clean install, production build/startup, unauthorized probes and repository validation passed without provider side effects. |
| 2026-09-11 | SPA-013 | Added the authenticated family workspace, RLS-backed views, owner settings, permission-checked reminder cancellation and broader phone-text redaction; marked SPA-013 Done and SPA-014 Ready. | Eighty-seven offline tests, lint, typecheck and production build passed. Embedded PostgreSQL denied cross-account management; live signed-out page and endpoint checks exposed no private data. |
| 2026-09-11 | SPA-012 | Added grounded terminal-call summaries, explicit action states, consent-gated persistence, atomic SMS reservation and honest incomplete/failure outcomes; marked SPA-012 Done and SPA-013 Ready. | Eighty-four offline tests, lint and typecheck passed. Embedded PostgreSQL verified consent, family RLS, retention deletion and one-winner SMS claiming without a live provider. |
| 2026-09-11 | SPA-011 | Added provider-neutral SMS/CALL-E delivery, current preference enforcement, bounded definite-failure retries and a service-role-only Supabase enqueue/claim/finish transaction; marked SPA-011 Done and SPA-012 Ready. | Seventy-eight offline tests, lint, typecheck, production build and repository validation passed. The embedded PostgreSQL migration enqueued, claimed and completed a synthetic reminder without a live provider. |
| 2026-09-11 | SPA-011 | Added cross-worker schedule locking, an authenticated host-scheduler endpoint and a 15-minute late-run cutoff that expires missed calls instead of dispatching them late. | Seventy-three offline tests, lint, typecheck, production build and repository validation passed. No scheduled provider request or live call ran. |
| 2026-09-11 | SPA-010 | Added documented MCP/REST boundaries, coarse terminal outcomes, an offline fixed-origin fake provider and a stale-lock-aware cross-worker file lock; marked SPA-010 Done and made SPA-011 next. | Seventy-one offline tests, lint, typecheck, production build and repository validation passed. CALL-E was not contacted and no call was placed. |
| 2026-09-11 | SPA-010, SPA-011 | Made the outbound-call purpose optional for immediate and scheduled calls. Empty input is shown as no specific purpose during confirmation, while the provider receives only a general-conversation instruction. | Fifty-three offline tests, lint, typecheck, repository validation and browser inspection passed; no live call was scheduled or placed. |
| 2026-09-11 | SPA-011 foundation | Added one-time scheduled CALL-E controls, explicit review/confirmation, encrypted local persistence, due-work claiming, status display and pre-dispatch cancellation. SPA-011 moved to In progress. | Fifty-two offline tests, lint, typecheck, production build, repository validation and browser inspection passed; no live call was scheduled or placed. |
| 2026-09-11 | SPA-010 | Added frontend destination and purpose configuration with masked review and explicit live-call confirmation. Removed the environment destination fallback; accepted calls register automatically for the monitoring table, while uncertain matching dispatches are held. SPA-010 moved to In progress. | Fifty offline tests, lint, typecheck, production build and repository validation passed. The form and existing one-call table were inspected without placing a new call; unconfirmed/invalid/cross-origin requests were denied. |
| 2026-09-11 | SPA-010 foundation | Replaced manual call-ID entry with a bounded server-side registry and automatic table of monitored calls. Active calls poll every two seconds and display redacted transcript turns as CALL-E publishes them. SPA-010 remains Ready because call planning, confirmed execution and durable registration/reconciliation are still required. | The local registry returned one completed call with 10 transcript turns without printing their private content. Automated checks and responsive page inspection passed; no new call was placed. |
| 2026-09-11 | SPA-013 foundation | Added an opt-in local conversation review panel to the developer Realtime page. Current caller/assistant text remains visible in memory; explicit saving retains at most 10 sessions in browser storage, excludes audio/tool payloads and provides a clear action. SPA-013 remains Backlog. | Forty-five offline tests, lint, typecheck and production build passed. The local page was inspected without starting a billable Realtime session. |
| 2026-09-11 | SPA-009 | Added confirmed, idempotent one-time reminder creation plus authorized listing/cancellation and timezone/DST clarification; marked SPA-009 Done and SPA-010 Ready. | Forty-three offline tests covered ambiguous/past/DST times, authorization, duplication, access denial and cancellation races. Lint, typecheck, production build and repository validation passed. |
| 2026-09-10 | SPA-008 | Added current news and local-event tools with confirmed context, concrete date windows, official-source guidance and requested SMS previews; moved web search to the current lower-cost supported model; marked SPA-008 Done and SPA-009 Ready. | Live news and event searches completed with five sources under redacted correlations `4600…0006` and `4c00…000c`; event output contained three dated options and availability caveats. Thirty-six offline tests, lint, typecheck, production build and repository validation passed. |
| 2026-09-10 | SPA-007 | Added Supabase persistence, verified-claims authentication, family RLS, consent/retention controls and durable action/SMS adapters; replaced the Docker workflow with embedded PostgreSQL validation; marked SPA-007 Done and SPA-008 Ready. | The migration and number-free seed applied in PGlite; family access, cross-account denial, consent triggers and restricted grants passed. Thirty-one offline tests, lint, typecheck, production build and repository validation passed. |
| 2026-09-10 | SPA-006 | Added the authorized, idempotent SMS workflow and storage/callback boundaries; kept all Twilio delivery work in final ticket SPA-004; marked SPA-006 Done and SPA-007 Ready. | Twenty-six offline tests, lint, typecheck and production build passed. Repository validation passed; no live message was sent. |
| 2026-09-10 | SPA-005 | Added shared server-side action authorization, strict E.164 validation, phone redaction, tool permissions and structured conversation boundaries; marked SPA-005 Done and SPA-006 Ready. | Twenty offline tests, lint and typecheck passed. Production build and repository validation also passed. No live side effect was enabled. |
| 2026-09-10 | SPA-004, SPA-005 | Deferred Twilio/inbound SIP to the final MVP gate without renumbering tickets; made SPA-005 Ready so safety and application work can continue. | The unfinished SIP implementation is preserved in the named local Git stash `defer twilio inbound sip spike`; no live carrier behavior is claimed. |
| 2026-09-10 | SPA-003 | Passed the same-session spoken search gate, corrected final-answer citation priority, marked SPA-003 Done and made SPA-004 Ready. | Live browser search completed under redacted correlation `f04c…d71d` with five sources in a six-item conversation; focused live citation verification returned five official URLs in 14,086 ms. Thirteen offline tests, lint and typecheck passed. |
| 2026-09-10 | SPA-003 | Added the server-side live web search backchannel and Realtime function tool; moved SPA-003 to In progress pending a same-session spoken check. | Lint, typecheck and 12 offline tests passed, including four fake-provider search tests. No live search result is claimed yet. |
| 2026-09-10 | SPA-002 | Passed the credentialed local Realtime audio gate, marked SPA-002 Done and made SPA-003 Ready. | User confirmed live audio worked. Browser recorded 3,665 ms establishment and four response measurements of 610–1,050 ms across 10 conversation items; session ended. Eight offline tests, lint and typecheck passed. |
| 2026-09-10 | SPA-002 | Implemented the protected local OpenAI Realtime WebRTC microphone harness; blocked completion on credentialed browser audio verification. | App checks and production build passed; 7 offline tests passed; production endpoint returned 403 for absent/cross-origin requests and 401 for an invalid token. No live audio metrics were invented. |
| 2026-09-10 | SPA-001 | Added the fullstack Next.js TypeScript scaffold with preview-only provider boundaries and marked SPA-002 Ready. | Clean install, app checks, production build/start, HTTP health/page checks, zero-vulnerability audit, repository validation and diff check passed. |
| 2026-09-10 | SPA-001, SPA-002, SPA-004, SPA-005, SPA-010, SPA-013–SPA-015 | Reviewed four PR discussions and three official-repository app READMEs; documented sources, corrected app placement and strengthened acceptance criteria. Implementation remains unstarted. | `python scripts/validate_repository.py` passed. |
| 2026-09-10 | SPA-001–SPA-019 | Established repository Markdown tracking with stable IDs, dependencies, milestone gates and acceptance checklists. SPA-001 is Ready; implementation has not started. | `python scripts/validate_repository.py` passed. |
