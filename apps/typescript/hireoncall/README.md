# HireOnCall

Apply by call. Hire by call.

A user-facing hiring scoreboard for the [CALL-E: Your Code Is Calling](https://call-e.devpost.com/) hackathon (**Most Practical Use Case**). Two one-off CALL-E calls close the loop: the hiring manager posts the JD by phone, the candidate applies by phone against those same skills, and structured results fill the portals. No application form.

This directory is the **Awesome Phone Call Agents** contribution. It is not a CALL-E SDK and it is not a submission to [CALL-E Integrations](https://github.com/CALLE-AI/call-e-integrations) (that repo is install/setup only).

- **Contribution area (official README):** User-facing Apps → `apps/`
- **Exact folder (CONTRIBUTING.md):** `apps/typescript/hireoncall/`
- **Live demo:** https://hireoncall.vercel.app
- **Source:** private GitHub https://github.com/prashantsingh2408/hireoncall (demo is public; no login)
- **Language:** TypeScript (Next.js App Router)
- **CALL-E surface used at runtime:** published TypeScript SDK `@call-e/calle` (`CalleClient.calls.createAndWait`), dual `resultSchema` / `recipientResultSchema`, optional unsigned terminal webhook
- **Hackathon resources:** [Devpost Resources](https://call-e.devpost.com/resources) · [CALL-E docs](https://docs.heycall-e.com) · [heycall-e.com](https://heycall-e.com)

Sits next to the listed inspiration patterns (customer outreach, appointment confirmation, **lead qualification**, order/exception follow-up, service dispatch, incident escalation) as a practical recruiting qualification loop. Related in-hub examples: [`call-reminder`](../../../skills/call-reminder/), [`google-form-callback`](../../../skills/google-form-callback/), [`outbound-call-skill-creator`](../../../skills/outbound-call-skill-creator/), [`python/batch-runner`](../../python/batch-runner/), [`plugins/n8n-calle-api`](../../../plugins/n8n-calle-api/).

## Why it's useful for AI-agent phone-call workflows

- **Closed loop, not a single transcript.** Call 1 returns a typed JD. Call 2's spoken `task` is compiled from Call 1 `mustHaveSkills`. The agent never hardcodes “Do you know PHP?”
- **Dual-schema CALL-E usage.** Task-level `resultSchema` (job captured / application filed) plus recipient-level `recipientResultSchema` (full JD / candidate JSON the UI flashes).
- **Inspectable artifacts.** Spoken scripts and JSON schemas ship in this folder so another agent can reuse the hiring loop without the private app repo.
- **Scoreboard, not a second form.** The website displays CALL-E results. Starting a call is optional UI for recording; production intent is phone-first.

## How CALL-E is used at runtime

Not a docs-only mention. The live app imports `@call-e/calle` and places calls:

```ts
client.calls.createAndWait({
  task,                    // from scripts/hr-call.md or scripts/employee-call.md
  recipients: [{ phones, region, locale }],
  resultSchema,            // task-level
  recipientResultSchema,   // schemas/hr-job.schema.json or schemas/candidate.schema.json
  metadata: { product: "hireoncall", kind: "hr" | "employee" },
  webhookUrl,              // optional POST /api/webhooks/calle
})
```

| Call | Spoken script | Recipient `resultSchema` |
| --- | --- | --- |
| 1 HR | [`scripts/hr-call.md`](scripts/hr-call.md) | [`schemas/hr-job.schema.json`](schemas/hr-job.schema.json) |
| 2 Employee | [`scripts/employee-call.md`](scripts/employee-call.md) | [`schemas/candidate.schema.json`](schemas/candidate.schema.json) |

Employee `{{MUST_HAVE_SKILLS}}` is filled from Call 1 JSON.

## Dry-run / preview behavior (default for inspection)

**Rehearsal replay places zero live CALL-E calls.** On the deployed demo or a local run:

```bash
curl -X POST https://hireoncall.vercel.app/api/demo/replay -H 'content-type: application/json' -d '{"step":"hr"}'
curl -X POST https://hireoncall.vercel.app/api/demo/replay -H 'content-type: application/json' -d '{"step":"employee"}'
```

Fixtures use fictional names and reserved-sample numbers in docs (`+15550100100` / `+15550100101`). Live dialing is opt-in: `CALLE_API_KEY` plus `HR_PHONE` / `CANDIDATE_PHONE` must be set, then `POST /api/calls/hr` and `POST /api/calls/employee`.

`POST /api/demo/reset` clears the scoreboard (rollback of rehearsal or ingested results on this app instance).

## Setup

Full app (private source). Public demo needs no keys.

```bash
# if you have source access
cp .env.example .env   # CALLE_API_KEY, HR_PHONE, CANDIDATE_PHONE — never commit values
npm install
npm test               # match + resume unit tests; no CALL-E credentials
npm run dev            # http://localhost:3040 — replay works without a key
```

CALL-E account install and SDK/MCP/CLI/SKILL quickstarts belong in [CALL-E Integrations](https://github.com/CALLE-AI/call-e-integrations), not this PR. Troubleshooting: Integrations install guide. API shapes: [docs.heycall-e.com](https://docs.heycall-e.com).

## Credential handling

- `CALLE_API_KEY` is server-only (Vercel env or `.env`). The browser never receives it.
- Phone numbers are operator env vars (`HR_PHONE`, `CANDIDATE_PHONE`), not a public form. Sample docs use fictional `+15550100xxx` only.
- Optional `CALLE_WEBHOOK_URL` points at `/api/webhooks/calle`. The handler checks `CALL-E-Event-Id` against the body id when present; current CALL-E deliveries are unsigned, so the live UI also waits on `createAndWait`.
- No secrets are committed. `.env` is gitignored.

## Side effects

- **Live mode places real outbound phone calls** through CALL-E (one HR recipient, then one candidate recipient). Each live POST spends CALL-E credits.
- Calls are **one-off**. HireOnCall does not create recurring schedules or hidden retry jobs.
- The agent discloses it is HireOnCall on the opening line of both scripts.
- Structured results (role, skills, CTC, notice) are stored on the app instance for the scoreboard. Do not put real candidate PII in shared screenshots.

## Cancellation / rollback

- There is no recurring job to cancel. Do not place the live POST if you do not want a call.
- `POST /api/demo/reset` drops local scoreboard state.
- Once CALL-E has accepted a live task, the in-progress call runs on the provider side; this app cannot tear down a ringing phone. Stop by not starting the second call.

## Tests / verification

```bash
npm test
```

Match scoring and voice-resume builders run against fixtures. No CALL-E credentials or real calls. Live verification is opt-in on a configured deploy: HR call, then employee call, then confirm portals fill from `structuredResult`.

## Safety notes

- Explicit operator intent: live routes refuse to dial when `CALLE_API_KEY` / phones are missing (503) instead of guessing numbers.
- E.164 numbers come from env, not free-typed public input.
- Scripts tell the agent not to invent skills the hiring manager did not say, and not to add skills off the Call 1 list.
- Hiring/CTC content is workplace logistics, not medical, legal-advice, or emergency dispatch.
- Samples in this folder use fictional data only.

## Compatibility

- Node 20+, npm. Next.js 16 on Vercel.
- Uses published `@call-e/calle` only. No unpublished or `file:` CALL-E packages.
- Region/locale defaults: `IN` / `en-IN` (overridable).

## Demo tape (~3 minutes)

For the Devpost video (YouTube or Vimeo, public, about three minutes; judges are not required to watch beyond that):

1. Cold open on the phone: HR and employee never need the website to start.
2. Call 1 — HR speaks role and must-have skills. Cut to HR portal: card fills, JSON flash, skill chips.
3. Call 2 — apply call asks those skills. Employee portal: profile, voice resume, Applied + match score.
4. Toggle portals. Do not click create-job or edit-profile forms (there are none).
5. Close: two calls. JD, skills, resume, application. Website is optional.
