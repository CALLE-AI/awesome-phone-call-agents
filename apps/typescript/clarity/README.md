# Clarity

Clarity finds an ambiguous claim in a job application and asks about it on one
short, adaptive phone call. It shows the clarified fact alongside the candidate's
words and a transcript timestamp.

The included fictional example turns **“98% CSAT”** into **“96% personal”**:
the candidate explains that 98% was the team metric, then gives their own score
across 45 surveys in response to a follow-up question.

Built with Next.js, React, TypeScript, Gemini, and CALL-E.

[Demo video](https://www.youtube.com/watch?v=_eHWqBgilrI) ·
[Project repository](https://github.com/michi883/clarity)

Contribution area: **User-facing Apps**. This directory contains the runnable
Clarity app, submitted as a new project for **CALL-E: Your Code Is Calling**.

## Quick start

Use Node.js 22.9 or later (`.nvmrc` selects Node 22).

```bash
cd apps/typescript/clarity
npm ci
cp .env.example .env
openssl rand -hex 32  # paste the result into CLARITY_AUTH_TOKEN in .env
npm run dev
```

Open [localhost:3000](http://localhost:3000). Sign in with username `clarity` and
your `CLARITY_AUTH_TOKEN` as the password. Select **Load example**, then
**Find what to clarify** → **Clarify by phone**.

The app defaults to `DEMO_MODE=replay`, even without an environment file. It runs the included synthetic
call without API keys, paid requests, or phone calls. Replay uses the example's
fixed questions and answers; it does not analyze custom applications.

## Live calls

Set `DEMO_MODE=live` in `.env`, add your API keys, and restart the server.

| Variable | Purpose |
| --- | --- |
| `DEMO_MODE` | `replay` for the fixture; explicitly set `live` for analysis and real calls. Unset or unrecognized values use replay. |
| `GEMINI_API_KEY` | Required for live application analysis. |
| `GEMINI_MODEL` | Optional analyzer model override. Defaults to `gemini-3.5-flash-lite`. |
| `CALLE_API_KEY` | Required to place and retrieve live calls. |
| `CLARITY_ORIGIN` | Exact browser origin for mutation checks; defaults to `http://localhost:3000`. Set your HTTPS deployment origin (or alternate local host/port). |
| `CLARITY_AUTH_TOKEN` | Required 32+ random character operator password in every mode. Never reuse a provider key. |
| `CALLE_BASE_URL` | Optional compatibility setting; only `https://api.heycall-e.com` (with optional trailing slash) is accepted. Redirects are refused. |
| `DEMO_PHONE_E164` | Recipient for the `call:capture` CLI tool only, in E.164 format. The app does not use this setting. |
| `CLARITY_WEBHOOK_SECRET` | Optional separate 32+ character bearer credential for a trusted webhook relay. Unset disables the webhook. |

After analysis, enter the agreed destination in **Candidate destination**. It must
be an exact ASCII E.164 number (`+` followed by country code and digits); spaces,
Unicode digits, extensions, trailing newlines and national-only numbers are
rejected. The app never selects a number from a résumé or written answers.

Confirm that you verified the exact number and have the recipient's consent and
authority for an English AI follow-up, then select **Confirm destination consent**.
The server stores the exact number, derived country, English language, operator,
and a 10-minute expiry on that application session. Only then can **Clarify by
phone** create a call. The call request cannot override the destination. Editing
and reanalyzing the application creates a new session requiring new consent.

International numbers are validated with libphonenumber-js. Routing uses the
number's country (for example, `GB` for a UK number), with locale `en` because the
brief is English. Region and language availability still depend on CALL-E; this
app does not claim every country or language is supported. Non-geographic numbers
and numbers whose country cannot be identified are rejected. Destination entry is
hidden by default with an explicit **Show** control; confirmation and result
summaries show only the last four digits.

Live analysis sends application text to Gemini and uses Gemini tokens. A live
call sends the recipient number, candidate/role context, selected claim, and
questions to CALL-E and uses CALL-E credits. Only use an authorized recipient
who has agreed to this application follow-up; for verification, use your own
phone and fictional candidate details. Verify the destination in the consent step and inspect the
question before selecting **Clarify by phone**. A number appearing in an
application does not itself establish permission to call.

## Cancellation and duplicate calls

Before dialing, go back or leave the page without selecting **Clarify by phone**.
Each application session uses a stable CALL-E idempotency key and reuses an
existing call ID on repeat requests. A private disk reservation is written before
calling; concurrent clicks cannot issue two creates. If creation times out, returns
an invalid response, or cannot be durably recorded, the session is halted. The
reservation also blocks a new session or CLI capture to that exact destination.
No create request is automatically retried, even with the same idempotency key.

Use **Reconcile existing call** with the call ID from CALL-E's dashboard. Match the
call's `metadata.session_id` to the session shown on the halted screen. The server
only GETs that call and verifies its ID, application metadata, exact destination,
and region before linking the result and releasing the reservation. Unrelated
calls are rejected. If the provider cannot establish what happened, leave the
reservation in place and contact provider support; do not reanalyze and redial.
Reconciliation also works through authenticated `POST /api/call/reconcile` with
`{ "sessionId": "<session-uuid>", "callId": "<existing-call-id>" }` or
`npm run call:reconcile -- <session-uuid> <existing-call-id>`.

A process crash may leave `data/locks/<session-uuid>`. Stop all app/capture
processes before an administrator removes that session's stale lock, then restart
and reconcile. Preserve the session JSON and `data/destinations/` reservations;
removing them defeats duplicate-call protection. Use one deployment with a
persistent local disk, not ephemeral or independently scaled instances.

Clarity creates no recurring schedules or automatic application-level retries.
Once CALL-E accepts a live call, closing the tab or stopping the local server
does not cancel it. There is no in-app remote hang-up control. The opening asks
whether now is a good time, and the task instructs the agent to end if the
recipient declines; the recipient can also hang up. A completed call cannot be
rolled back. To disable live mode for subsequent analyses, set `DEMO_MODE=replay`,
restart the server, and start a fresh session.

The separate `call:capture` command is an explicit live action regardless of
`DEMO_MODE`; pass `--consent` only after verifying the exact `DEMO_PHONE_E164`
and recipient agreement. It uses the same durable consent and destination
reservation as the app, and prints its session ID before any create. A successful
new invocation can place a new call. Run `call:preview` first and reconcile an
interrupted capture instead of restarting it.
Stopping its polling process does not cancel an accepted call.

## How it works

1. Gemini proposes up to three job-relevant ambiguities. Guardrails locate each
   claim in the original application text and filter questions about sensitive
   personal attributes. Only the first clarification is called about.
2. CALL-E receives the opening question, a brief that requests one adaptive
   follow-up, and a structured result schema. The opening identifies the caller
   as an AI and asks whether now is a good time.
3. The app polls the call, normalizes the provider response, and displays the
   corrected fact, supporting quote, conversation trail, and remaining unknowns.

Clarity does not score candidates or recommend hiring decisions. Its evidence
comes from transcripts and structured results; the app does not provide audio
recordings. The text filters and call instructions are safeguards, not a complete
policy enforcement system.

Keep the workflow limited to factual, job-relevant clarification. Do not use it
for medical, legal, financial, or emergency advice, or to automate hiring
decisions. A person must review the transcript and unresolved questions.

## Development

```bash
npm test             # offline tests
npm run typecheck    # strict TypeScript checks, including unused code
npm run check        # typecheck and tests
npm run build        # production build
npm start            # serve the production build
```

`/?debug=1` loads the synthetic example and lets you step through the normal UI
without contacting Gemini or CALL-E. The call screen waits for **skip to result**.
Use `/?debug=1&fail=1` to inspect the failed-call result.

The CLI tools use the same application fixture, brief, and result schema as the
app:

```bash
npm run call:preview                   # print the brief and schema; no network
npm run analyze                        # analyze the example; uses Gemini tokens
npm run call:capture -- --consent       # authorized real call to DEMO_PHONE_E164
npm run call:reconcile -- <session-id> <call-id> # retrieve and link; never dials
npm run call:inspect -- <call-id>       # fetch an existing call; never redials
npm run call:inspect -- data/captures/<timestamp>.json
npm run replay:promote -- data/captures/<timestamp>.json
```

Captures are written to `data/captures/`. Promotion validates a completed result,
redacts phone fields, and writes `fixtures/golden-run.json` for local replay.
Replay prefers that file when present; debug always uses the synthetic example.
Captured transcripts may still contain personal information, so both captures
and promoted runs are gitignored.

For an offline verification, run `npm run check`, `npm run call:preview`, and
`npm run build`. In replay mode, follow the quick-start flow and verify that
**98% CSAT** becomes **96% personal**, supported by the candidate's words and
**45 surveys**. The replay is labelled synthetic. No provider credentials or
outbound calls are required.

## Project layout

```text
app/
  components/       Application form, clarification, call, and result screens
  api/              Analyze, call, polling, webhook, example, and debug routes
lib/
  analyze.ts        Gemini prompt and response validation
  calle.ts          CALL-E client, task brief, and result schema
  call-record.ts    Response normalization and transcript evidence helpers
  call-status.ts    Call progress and failure descriptions
  guardrails.ts     Claim anchoring and sensitive-attribute filters
  auth.ts           Operator authentication and separate webhook authentication
  live-call.ts      Consent, durable create protection, and reconciliation
  phone.ts          Strict E.164 validation, country routing, and masking
  replay.ts         Fixture loading and replay timing
  result.ts         Result presentation and conversation trail
  session.ts        Atomic private JSON storage and durable reservations
  types.ts          Shared domain types
fixtures/           Fictional application, clarifications, and synthetic call
scripts/            Analysis, capture, inspection, and local replay tools
tests/              Offline regression tests
```

## Data and deployment

All app pages and data routes require HTTP Basic authentication in every mode;
there is no localhost, forwarded-header, replay, or debug bypass. The account is
`clarity`; configure a unique random password in `CLARITY_AUTH_TOKEN`. Use HTTPS
for remote hosting (for example through your TLS reverse proxy), keep the backend
port private, and never expose plaintext HTTP credentials over a network. Browser
mutations reject cross-origin requests against the configured `CLARITY_ORIGIN`,
independent of forwarded or internal server host headers. Responses are not cached. Session reads
also require the owning operator credential; rotating it invalidates access to
old sessions. This is a single-operator demo, not a multi-user identity system.

There are no application rate limits, database or distributed session store.
File-backed sessions and call reservations require persistent writable storage;
storage failures fail closed before dialing. Session files use private permissions
and atomic replacement. Do not deploy multiple replicas on independent disks.

The optional webhook is disabled unless `CLARITY_WEBHOOK_SECRET` is configured.
CALL-E's current unsigned deliveries cannot authenticate directly: use a trusted
relay that supplies `Authorization: Bearer <CLARITY_WEBHOOK_SECRET>`, or just use
polling. The former `CALLE_WEBHOOK_URL` setting is no longer used. A delivery is
only a hint to GET a known call from the pinned CALL-E API; supplied transcripts,
results, summaries and status are discarded. Provider responses must match the
stored call and authorized destination before they can update evidence. Duplicate
events refresh the same record; failed verification returns a retryable error and
does not consume an event ID. Do not expose the relay credential in callback URLs.

`.env`, `data/`, local captured fixtures, dependencies, and build output are
excluded by `.gitignore`. Share the source files through Git rather than uploading
the entire working directory, which can still contain credentials and local data.
Only fictional examples belong in shared fixtures.

Keep API keys server-side in the ignored `.env` file. Local application sessions,
transcripts, capture output, and inspection output can contain personal data;
review and redact them before sharing. Mask recipient numbers in shared summaries
(for example, `***0100`). The operator can explicitly reveal the destination during
entry; confirmation, API result views, and capture startup logs mask it. This app does not implement an
automated retention or deletion policy. All committed candidate details and
transcripts are fictional; test numbers are reserved examples and must not be
used as live destinations.
