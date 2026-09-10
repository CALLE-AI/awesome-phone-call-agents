# Senior Phone AI progress and tickets

This file is the source of truth for implementation tickets and progress. Update it as work changes; no external ticket service is required.

## Project

Build a phone-native AI assistant for seniors: ask, search, understand, remember and act through a normal phone call. Seniors do not need an app or browser. The web interface serves authorized family members and carers.

- Stack: fullstack Next.js, TypeScript, React and Node.js, with Supabase PostgreSQL.
- Architecture: one realtime conversation agent with a small tool layer; CALL-E handles outbound phone actions.
- Branch: `feat/senior-phone-ai-app`.
- Planned app directory: `apps/typescript/senior-phone-ai/`.
- Scope: 15 MVP tickets and 4 optional extensions.
- Live information must be retrieved after the caller asks and answered during that same call. Fake providers are for explicitly labeled development/tests only.
- Host scheduling owns recurrence; the provider handles one call per scheduled run.
- Provider capabilities and deployment requirements must be verified during implementation.

## Current progress

Last updated: 2026-09-10

Implementation is in progress. MVP: **3/15 done**. Optional extensions: **0/4 done**.

Next ticket: [SPA-005](#spa-005), which is Ready after the browser same-session search gate passed. The Twilio/inbound SIP gate remains [SPA-004](#spa-004) but runs last in the MVP sequence.

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
| M4: Optional extensions | SPA-016–SPA-019 | Selected extensions meet their own acceptance criteria after the MVP |

## Ticket board

| ID | Ticket | Milestone | Priority | Status | Depends on |
|---|---|---|---|---|---|
| [SPA-001](#spa-001) | Scaffold the fullstack Next.js TypeScript app | M1 | High | Done | None |
| [SPA-002](#spa-002) | Prove local realtime audio conversation and session lifecycle | M1 | High | Done | [SPA-001](#spa-001) |
| [SPA-003](#spa-003) | Add live web search to the ongoing realtime conversation | M1 | High | Done | [SPA-002](#spa-002) |
| [SPA-005](#spa-005) | Enforce tool permissions and senior conversation safety | M2 | Medium | Ready | [SPA-003](#spa-003) |
| [SPA-006](#spa-006) | Send requested information by SMS during the call | M2 | Medium | Backlog | [SPA-005](#spa-005) |
| [SPA-007](#spa-007) | Add Supabase persistence, family authentication and data access controls | M2 | Medium | Backlog | [SPA-006](#spa-006) |
| [SPA-008](#spa-008) | Add live news and local-event discovery | M2 | Medium | Backlog | [SPA-007](#spa-007) |
| [SPA-009](#spa-009) | Create, list and cancel confirmed reminders with timezone handling | M2 | Medium | Backlog | [SPA-007](#spa-007) |
| [SPA-010](#spa-010) | Integrate CALL-E outbound planning, execution and result tracking | M2 | Medium | Backlog | [SPA-007](#spa-007) |
| [SPA-011](#spa-011) | Schedule durable reminder delivery through SMS and CALL-E | M2 | Medium | Backlog | [SPA-009](#spa-009), [SPA-010](#spa-010) |
| [SPA-012](#spa-012) | Create opt-in post-call summaries and SMS follow-up | M2 | Medium | Backlog | [SPA-007](#spa-007), [SPA-009](#spa-009) |
| [SPA-013](#spa-013) | Build the minimal authorized family and carer dashboard | M2 | Medium | Backlog | [SPA-008](#spa-008), [SPA-011](#spa-011), [SPA-012](#spa-012) |
| [SPA-014](#spa-014) | Verify resilience, privacy and end-to-end workflow behavior | M3 | Medium | Backlog | [SPA-013](#spa-013) |
| [SPA-015](#spa-015) | Document deployment and run the polished Margaret MVP demo | M3 | Medium | Backlog | [SPA-014](#spa-014) |
| [SPA-004](#spa-004) | Connect Twilio inbound SIP calls and pass the live phone search gate | M3 | High | Backlog | [SPA-015](#spa-015) |
| [SPA-016](#spa-016) | Optional: call a venue on the senior's behalf and return the result | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-017](#spa-017) | Optional: contact trusted family on explicit senior request | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-018](#spa-018) | Optional: add weather and government-information tools | M4 | Low | Backlog | [SPA-004](#spa-004) |
| [SPA-019](#spa-019) | Optional: add explicitly scheduled recurring check-ins | M4 | Low | Backlog | [SPA-004](#spa-004) |

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

**Connect Twilio inbound SIP calls and pass the live phone search gate**

Connect a normal telephone number through Twilio SIP trunking to the realtime agent as the final MVP ticket.
Acceptance criteria:
- [ ] Verify supported provider/OpenAI integration and hosting requirements against current official documentation; record capability gaps.
- [ ] Authenticate inbound events, deduplicate delivery, manage call/session teardown and secure the server-side tool-control channel.
- [ ] Verify authentication against the actual transport contract. Public call/log/transcript routes are forbidden; an unsigned notification is never trusted as an authoritative result.
- [ ] A real caller asks a previously unknown question, external search starts afterward, and the retrieved answer is heard during that same phone call.
- [ ] Record redacted timestamps/correlation evidence and observed latency; exercise follow-up and interruption.
- [ ] Live checks require explicit consent and configured test numbers. Run this gate only after SPA-015 passes.
- [ ] Keep CALL-E for outbound actions; do not assume CALL-E inbound live tool calling.

Implementation notes and verification: Not started.

### SPA-005

**Enforce tool permissions and senior conversation safety**

Implement shared safety and consent checks before exposing side-effect tools.
Acceptance criteria:
- [ ] Read-only tools may run automatically; external actions require explicit intent with recipient, purpose and relevant details confirmed.
- [ ] Consent is bound to the specific action and cannot be fabricated by search results or provider output.
- [ ] Persist exact destination and purpose authorization server-side; changed parameters invalidate approval. A confirmation phrase is not endpoint authentication. Require strict ASCII E.164 at dispatch.
- [ ] Validate E.164 numbers; mask numbers in summaries/logs and keep credentials and sensitive authentication data out of prompts and UI.
- [ ] Disclose AI identity, support gentle conversation without impersonating family, clinicians, therapists or emergency services.
- [ ] No diagnosis, medication changes, personalized high-risk legal/financial advice or emergency guarantees; direct urgent needs toward appropriate human channels.
- [ ] Bookings/purchases remain outside the MVP. Test denied, expired/mismatched and confirmed action paths.

Implementation notes and verification: Not started.

### SPA-006

**Send requested information by SMS during the call**

Implement sendSms behind a provider adapter (for example Twilio, subject to verified integration).
Acceptance criteria:
- [ ] A request such as 'send me the details' sends a concise, scannable message during the active call to a confirmed destination.
- [ ] Information includes relevant event time/address/source link without invented details.
- [ ] Third-party recipients require explicit confirmation; validate E.164 and mask numbers in operational output.
- [ ] Return queued/sent/failed states accurately, verify delivery callbacks and deduplicate sends.
- [ ] Include dry-run preview and fake-provider tests; live delivery is explicitly enabled.
- [ ] Provide a storage interface that the Supabase persistence ticket will implement.

Implementation notes and verification: Not started.

### SPA-007

**Add Supabase persistence, family authentication and data access controls**

Add Supabase PostgreSQL migrations and server data access for seniors, trusted contacts, preferences, calls, optional transcripts, summaries, tool activity, SMS, reminders and scheduled check-ins.
Acceptance criteria:
- [ ] Store timezone, approximate location and interests; use a synthetic Margaret fixture with no real phone number.
- [ ] Family/carer authentication and membership authorization restrict each user's senior records; verify cross-account access denial and RLS.
- [ ] Caller ID alone is not sufficient authorization to expose private data; define a low-friction safe enrollment/verification flow.
- [ ] Persist SMS history and tool/call correlation without credentials; keep service credentials server-only.
- [ ] Define senior-approved sharing, minimal collection, retention/deletion and optional recording/transcript consent before enabling storage.
- [ ] Migrations and seeds run locally; document rollback and schema relationships.

Implementation notes and verification: Not started.

### SPA-008

**Add live news and local-event discovery**

Implement searchNews and searchLocalEvents with the existing live tool dispatcher.
Acceptance criteria:
- [ ] Search after each live request; prioritize useful current sources, local councils, libraries and community listings.
- [ ] Resolve 'this week' and 'nearby' using confirmed location and timezone; ask when location is missing.
- [ ] Return event dates, venue, address, availability uncertainty and sources, filtering stale/irrelevant results.
- [ ] Give short spoken answers and offer requested SMS through the existing tool.
- [ ] Never present the sample gardening workshop as a verified real event.
- [ ] Cover empty results, stale listings, tool errors and follow-up questions.

Implementation notes and verification: Not started.

### SPA-009

**Create, list and cancel confirmed reminders with timezone handling**

Implement createReminder, listReminders and cancelReminder with durable state.
Acceptance criteria:
- [ ] Resolve natural-language dates in the senior's IANA timezone; clarify ambiguous 'Friday at 10', AM/PM and DST cases.
- [ ] Confirm exact date/time, message and SMS/call channel before saving.
- [ ] Persist consent, action identity and lifecycle state; repeated tool execution does not create duplicates.
- [ ] Allow authorized listing/cancellation and explain whether a delivery has already started.
- [ ] One-time reminders are the MVP; recurrence must never be silently inferred.
- [ ] Test ambiguous dates, past dates, DST, repeated requests and cancellation races.

Implementation notes and verification: Not started.

### SPA-010

**Integrate CALL-E outbound planning, execution and result tracking**

Wrap CALL-E MCP behind planOutboundCall, executeOutboundCall and getOutboundCallResult.
Acceptance criteria:
- [ ] Verify current plan_call/run_call/get_call_run schemas and limitations before implementation; do not assume MCP and REST parity.
- [ ] Restrict credential-bearing requests to verified provider origins, reject credential-leaking redirects and keep fake adapters isolated from production keys. Do not interpolate tool input into shell commands.
- [ ] Dispatch only an explicitly confirmed action to a validated E.164 destination; persist provider IDs and action identity.
- [ ] Validate structured results and treat provider content as untrusted.
- [ ] Handle pending, completed, no-answer, voicemail, failure and unknown dispatch outcomes.
- [ ] Never blindly retry an uncertain dispatch; reconcile first and expose unresolved status.
- [ ] Persist the intent before submission and retain the uncertainty hold across restarts, concurrent workers and new sessions; a process-local deduplication map is insufficient.
- [ ] Explain cancellation limits honestly, particularly once a call is in flight.
- [ ] Include a local fake server/dry-run adapter; no default real outbound calls.

Implementation notes and verification: Not started.

### SPA-011

**Schedule durable reminder delivery through SMS and CALL-E**

Connect confirmed reminders to a durable host scheduler and one-time provider dispatch.
Acceptance criteria:
- [ ] Host scheduler owns recurrence; each scheduled run invokes exactly one call per intended call delivery.
- [ ] Atomically claim due work and use durable idempotency to prevent duplicate jobs/calls across retries or concurrent workers.
- [ ] Honor timezone, consent, cancellation, channel preferences and a documented late-run policy.
- [ ] Support SMS and CALL-E reminder delivery with accurate status recording.
- [ ] Reconcile uncertain dispatch instead of retrying blindly; bounded safe retries cover known retryable failures.
- [ ] Disabling/canceling stops future dispatch; already in-flight actions are described accurately.
- [ ] Test scheduler restart, duplicate execution, cancellation race and provider failure without live calls.

Implementation notes and verification: Not started.

### SPA-012

**Create opt-in post-call summaries and SMS follow-up**

Generate a brief summary from actual conversation/tool outcomes after a call.
Acceptance criteria:
- [ ] Include only grounded information and saved/confirmed actions; distinguish failed or pending actions.
- [ ] Send concise SMS only when opted in, with a confirmed recipient and minimal sensitive content.
- [ ] Deduplicate finalization and summary delivery across repeated call-end events.
- [ ] Persist summaries and delivery outcomes with access controls and retention policy.
- [ ] Handle incomplete/disconnected calls and failed SMS honestly.

Implementation notes and verification: Not started.

### SPA-013

**Build the minimal authorized family and carer dashboard**

Implement /dashboard, /seniors, /seniors/[id], /calls, /reminders and /settings in Next.js.
Acceptance criteria:
- [ ] Authorized carers see relevant senior profiles, trusted contacts, recent calls, confirmed actions, reminder states and SMS delivery.
- [ ] Last successful check-in reflects an actual recorded event, never an inferred wellness assessment.
- [ ] Support approved profile/preferences and reminder management using the same permission checks as voice workflows.
- [ ] Show loading, empty, error and pending states; mask phone numbers where appropriate and use accessible responsive controls.
- [ ] Do not show loneliness, psychological or medical risk scores.
- [ ] Verify cross-account access denial through both pages and server endpoints.
- [ ] Render provider-controlled results/errors as text and redact nested phone/contact/transcript content before public output; cover formatted and local-number forms as well as E.164.

Implementation notes and verification: Not started.

### SPA-014

**Verify resilience, privacy and end-to-end workflow behavior**

Add focused automated integration tests for the complete MVP using fake providers by default.
Acceptance criteria:
- [ ] Cover duplicate/out-of-order webhooks, tool/API timeouts, disconnected realtime sessions and malformed CALL-E results.
- [ ] Cover no answer, voicemail, SMS failure, scheduler retries and unknown dispatch without duplicate calls.
- [ ] Test explicit consent, action authorization, E.164 validation, redaction and cross-account data isolation.
- [ ] Capture safe correlation IDs and latency/outcome metrics; never log credentials or full sensitive transcripts by default.
- [ ] Run typecheck, lint, production build, app tests and python scripts/validate_repository.py.
- [ ] Verify clean install and production startup, unauthorized endpoint access, destination substitution, credential-origin rejection, untrusted HTML rendering and uncertainty recovery after restart.
- [ ] Document residual risks and manual live checks separately from deterministic tests.

Implementation notes and verification: Not started.

### SPA-015

**Document deployment and run the polished Margaret MVP demo**

Prepare operating documentation and a reproducible end-to-end demo.
Acceptance criteria:
- [ ] Document Next.js/Node hosting, Supabase migrations, scheduler, secrets and non-SIP provider configuration; leave Twilio/SIP setup for SPA-004.
- [ ] Document side effects, consent, cancellation/disable behavior, rollback, retention and troubleshooting.
- [ ] Demonstrate browser realtime conversation → arbitrary live news/search → current local event → requested SMS → confirmed reminder → CALL-E reminder delivery → dashboard state.
- [ ] Use current retrieved events; no hardcoded demo answers. Clearly label offline fake mode.
- [ ] Run live SMS only with explicit test consent and configured recipients; collect redacted evidence of same-session browser search. The live telephone proof belongs to SPA-004.
- [ ] Keep optional call-on-behalf outside the required MVP acceptance.
- [ ] Prepare repository-facing documentation in English under apps/typescript/senior-phone-ai/ and docs/ as appropriate.
- [ ] Review the full PR diff, relevant history, screenshots, video and linked public artifacts for credentials and personal data. Use number-free synthetic fixtures where possible; any full example number must be verified reserved fiction and rejected by live dispatch.
- [ ] Add a factual app catalog entry, complete the PR template, and keep the title/body aligned with the actual scoped contribution. Make no clinical or production-readiness claims without evidence.

Implementation notes and verification: Not started.

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

## Progress log

| Date | Tickets | Update | Verification |
|---|---|---|---|
| 2026-09-10 | SPA-004, SPA-005 | Deferred Twilio/inbound SIP to the final MVP gate without renumbering tickets; made SPA-005 Ready so safety and application work can continue. | The unfinished SIP implementation is preserved in the named local Git stash `defer twilio inbound sip spike`; no live carrier behavior is claimed. |
| 2026-09-10 | SPA-003 | Passed the same-session spoken search gate, corrected final-answer citation priority, marked SPA-003 Done and made SPA-004 Ready. | Live browser search completed under redacted correlation `f04c…d71d` with five sources in a six-item conversation; focused live citation verification returned five official URLs in 14,086 ms. Thirteen offline tests, lint and typecheck passed. |
| 2026-09-10 | SPA-003 | Added the server-side live web search backchannel and Realtime function tool; moved SPA-003 to In progress pending a same-session spoken check. | Lint, typecheck and 12 offline tests passed, including four fake-provider search tests. No live search result is claimed yet. |
| 2026-09-10 | SPA-002 | Passed the credentialed local Realtime audio gate, marked SPA-002 Done and made SPA-003 Ready. | User confirmed live audio worked. Browser recorded 3,665 ms establishment and four response measurements of 610–1,050 ms across 10 conversation items; session ended. Eight offline tests, lint and typecheck passed. |
| 2026-09-10 | SPA-002 | Implemented the protected local OpenAI Realtime WebRTC microphone harness; blocked completion on credentialed browser audio verification. | App checks and production build passed; 7 offline tests passed; production endpoint returned 403 for absent/cross-origin requests and 401 for an invalid token. No live audio metrics were invented. |
| 2026-09-10 | SPA-001 | Added the fullstack Next.js TypeScript scaffold with preview-only provider boundaries and marked SPA-002 Ready. | Clean install, app checks, production build/start, HTTP health/page checks, zero-vulnerability audit, repository validation and diff check passed. |
| 2026-09-10 | SPA-001, SPA-002, SPA-004, SPA-005, SPA-010, SPA-013–SPA-015 | Reviewed four PR discussions and three official-repository app READMEs; documented sources, corrected app placement and strengthened acceptance criteria. Implementation remains unstarted. | `python scripts/validate_repository.py` passed. |
| 2026-09-10 | SPA-001–SPA-019 | Established repository Markdown tracking with stable IDs, dependencies, milestone gates and acceptance checklists. SPA-001 is Ready; implementation has not started. | `python scripts/validate_repository.py` passed. |
