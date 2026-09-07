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
npm run dev
```

Open [localhost:3000](http://localhost:3000), select **Load example**, then
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
| `CALLE_BASE_URL` | Optional API endpoint override. Defaults to `https://api.heycall-e.com`. |
| `DEMO_PHONE_E164` | Recipient for the `call:capture` CLI tool only, in E.164 format. The app does not use this setting. |
| `CALLE_WEBHOOK_URL` | Optional public HTTPS URL for `/api/calle/webhook`. Polling works without it. |

Live calls use the phone number found in the submitted résumé or written
answers. The interface shows that number before a call can be placed. The
fictional example has no number: add your test recipient's number to its résumé
before using it in live mode. There is no environment fallback. For
international numbers, include an explicit country code; bare ten-digit numbers
are interpreted as North American numbers.

Live analysis sends application text to Gemini and uses Gemini tokens. A live
call sends the recipient number, candidate/role context, selected claim, and
questions to CALL-E and uses CALL-E credits. Only use an authorized recipient
who has agreed to this application follow-up; for verification, use your own
phone and fictional candidate details. Inspect the displayed recipient and
question before selecting **Clarify by phone**. A number appearing in an
application does not itself establish permission to call.

## Cancellation and duplicate calls

Before dialing, go back or leave the page without selecting **Clarify by phone**.
Each application session uses a stable CALL-E idempotency key and reuses an
existing call ID on repeat requests. Creating a new session is a new call intent;
do not re-analyze and redial to recover a delayed result. Retrieve the existing
call with `npm run call:inspect -- <call-id>` instead.

Clarity creates no recurring schedules or automatic application-level retries.
Once CALL-E accepts a live call, closing the tab or stopping the local server
does not cancel it. There is no in-app remote hang-up control. The opening asks
whether now is a good time, and the task instructs the agent to end if the
recipient declines; the recipient can also hang up. A completed call cannot be
rolled back. To disable live mode for subsequent analyses, set `DEMO_MODE=replay`,
restart the server, and start a fresh session.

The separate `call:capture` command is an explicit live action regardless of
`DEMO_MODE`; each invocation uses a new idempotency key and can place a new call.
Run `call:preview` first and do not restart a capture to recover its result.
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
npm run call:capture                   # place one real call to DEMO_PHONE_E164
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
  phone.ts          Phone-number parsing
  replay.ts         Fixture loading and replay timing
  result.ts         Result presentation and conversation trail
  session.ts        In-memory sessions mirrored to local JSON files
  types.ts          Shared domain types
fixtures/           Fictional application, clarifications, and synthetic call
scripts/            Analysis, capture, inspection, and local replay tools
tests/              Offline regression tests
```

## Data and deployment

This is a local demo with no authentication, rate limits, database, or shared
session store. Add access controls before exposing a live instance: its API can
spend provider credits and retrieve application and transcript data. File-backed
sessions need a writable filesystem and are intended for a single server process.

`.env`, `data/`, local captured fixtures, dependencies, and build output are
excluded by `.gitignore`. Share the source files through Git rather than uploading
the entire working directory, which can still contain credentials and local data.
Only fictional examples belong in shared fixtures.

Keep API keys server-side in the ignored `.env` file. Local application sessions,
transcripts, capture output, and inspection output can contain personal data;
review and redact them before sharing. Mask recipient numbers in shared summaries
(for example, `***0100`). The UI shows the full destination for the operator's
pre-call check; capture startup logs mask it. This app does not implement an
automated retention or deletion policy. All committed candidate details and
transcripts are fictional; test numbers are reserved examples and must not be
used as live destinations.
