# DineLine CALL-E Edition

DineLine CALL-E Edition is a native two-agent restaurant concierge built for
the CALL-E Hackathon. One CALL-E agent calls the diner and captures the dinner
request. The generated n8n workflow implements the path from that request to
five Google Places choices. After the user selects and approves one restaurant,
Agent Jake uses CALL-E to make the booking call and returns an evidence-checked
result.

The project is isolated from the operational DineLine V1 and V2 repositories.
It does not modify or depend on Vapi at runtime.

## Project origin and timeline

DineLine was not conceived for the CALL-E Hackathon. It is an existing project
that Gregory Schwartz designed and built before the hackathon submission period
opened:

- **April 2026 - DineLine V1:** Greg built the original restaurant concierge
  for his ODSC AI Engineering Accelerator capstone. Its dated repository history
  begins on April 12, and commit `12ca50b` recorded a working AI-to-AI
  restaurant reservation on April 16.
- **Memorial Day weekend 2026 - DineLine V2:** Greg rebuilt DineLine as a leaner,
  reusable voice-agent platform. Commit `fef94ba` records the initial V2 build
  on May 25, followed that morning by direct phone-booking, n8n, rejection-path,
  and call-result improvements.
- **July 23, 2026 - CALL-E submission period opened:** both original DineLine
  versions already existed before the hackathon submission period began.
- **September 2026 - DineLine CALL-E Edition:** this edition is the significant
  hackathon-period update. It adapts Greg's existing discovery-to-booking
  architecture to two native CALL-E agents and adds stricter approval,
  idempotency, evidence verification, and fixture-demo boundaries.

This chronology establishes that the restaurant discovery and phone-booking
concept existed before the CALL-E submission period. Greg had already developed
it independently before he saw the restaurant-agent example associated with the
hackathon. The submission is a CALL-E-native extension of his prior work, not a
copy of that example. See the
[project provenance record](docs/PROJECT_PROVENANCE.md) for the dated evidence
and scope distinction.

## Authorship

Gregory Schwartz conceived and built DineLine V1 and DineLine V2, including the
Vapi agents, system prompts, tools, webhooks, and n8n workflow nodes. The CALL-E
Edition extends Greg's original product and architecture. Codex served as an
implementation partner for this time-boxed edition under Greg's direction; it
did not originate DineLine.

## Why DineLine is more than a booking agent

A basic restaurant-calling agent starts after someone has already chosen where
to eat. DineLine starts earlier and completes the whole decision-to-action loop:

`Understand -> Discover -> Compare -> Approve -> Call -> Verify -> Return`

The first agent gathers the diner's real constraints and ends with a structured
request. CALL-E runs phone work as asynchronous tasks, so the app becomes the
handoff between calls: the generated n8n integration searches live Google
Places data, returns five grounded choices, and waits for the diner to choose.
Only after that choice and an exact approval does the second agent call the
restaurant. The verified outcome then returns to the app. That discovery-plus-
execution architecture is the core distinction from a single restaurant-
booking agent.

## Reusable architecture

This repository implements the restaurant use case, but its orchestration
pattern is designed to be reusable:

- **Consumer side:** understand a need, discover grounded options, help the user
  decide, perform an approved phone action, and return the outcome.
- **Business side:** receive an inbound request, collect and qualify the details,
  schedule or route the request, and trigger an appropriate follow-up.
- **Restaurant side:** the same separation of roles can support a restaurant
  receiving reservation requests, checking required details, booking or
  escalating the request, and confirming the result.

CaseCapture is a separate controlled three-agent prototype applying this broader
pattern to U.S. law-firm intake, scheduling, and referral. It remains
non-production and uses synthetic rules; it is not part of this CALL-E
submission. It shows where the architecture goes next without overstating what
is complete today.

## Current build

- CALL-E Agent 1, the DineLine Concierge, collects dining preferences by phone.
- A strict result schema captures location, cuisine, date, time, party size,
  budget, atmosphere, dietary needs, and notes without inventing missing data.
- The generated n8n workflow validates the Agent 1 result, searches Google
  Places, normalizes and ranks results, and returns five choices when configured
  with live credentials. The public walkthrough uses fixtures; a separate,
  bounded live Google Places request returned HTTP 200 and ranked five options
  through the same request and ranking contract.
- The selected Google result is recovered from n8n's cache rather than trusted
  from arbitrary browser input.
- A readable booking contract binds the user's approval to the exact restaurant,
  date, time, party size, guest, destination, and booking rules.
- CALL-E Agent 2, Agent Jake, makes only the approved booking request.
- Separate idempotency records prevent duplicate Agent 1 and Agent 2 calls.
- CALL-E call creation and result waiting are separate, so an accepted call ID
  is journaled even if the bounded five-minute wait expires.
- Ambiguous dispatch is fail-closed and never retried automatically; the UI can
  read the exact journal-bound call again without creating another call.
- Returned structured data and evidence must agree before DineLine reports a
  reservation as confirmed.
- Fixture providers and five fictional restaurants support a complete no-call
  demo in the same interface used by the real providers.

No test or fixture command places a phone call.

## Controlled live verification

On September 14, two separately authorized calls to an owned test line verified
the native CALL-E roles without contacting a restaurant. The DineLine Concierge
captured a complete, search-ready dinner request in clear English. In a separate
call, Agent Jake returned a confirmed reservation outcome while Greg role-played
the restaurant, and DineLine's evidence verifier accepted it without human
review. These were role-level canaries, not a claimed live execution of the
entire staged workflow. The public judge experience remains fixture-only.

## Run locally

```powershell
npm ci
npm run build:n8n
npm run check
npm run ui
```

Open `http://127.0.0.1:4173`. In fixture mode:

1. Enter the reserved sample number `+12025550109`.
2. Approve one simulated planning call.
3. Review the evidence-backed dinner request.
4. Choose one of five fictional restaurant results.
5. Review the exact booking contract.
6. Approve and run the simulated Agent Jake call.
7. Inspect the returned evidence and duplicate-call guard.

The visible flow is:

`Plan -> Search -> Choose -> Approve -> Call -> Verify -> Report`

Changing any booking detail after review invalidates the fingerprint and
requires fresh approval. An incomplete Agent 1 result does not start restaurant
search and does not receive invented fallback values.

## n8n artifacts

The generated files under `n8n/` are sanitized and inactive:

- `dineline-calle-edition.workflow.json` is the native two-agent integration.
- `dineline-calle-fixture-roundtrip.workflow.json` is the repeatable no-call
  proof that executes both agent boundaries.

See `n8n/README.md` for import and execution commands.
The latest no-call run is recorded in
[`docs/N8N_FIXTURE_EVIDENCE.md`](docs/N8N_FIXTURE_EVIDENCE.md).

## Public judge mode

The Vercel adapter in `api/index.ts` hard-forces fixture mode and closes both
real-call gates. A public deployment therefore exercises the visible two-agent
journey without placing calls, consuming CALL-E credits, or exposing a key.

The five restaurant cards in the standalone browser are fictional fixtures.
The generated n8n integration is where live Google Places search, ranking, and
selected-result recovery are implemented. This keeps the public demo safe while
leaving the full integration inspectable and reproducible.

## Controlled real-call setup

Real CALL-E execution is local-only and opt-in. Copy `.env.example` to
`.env.local`, add a server-side `CALLE_API_KEY`, and set `DINELINE_CALL_MODE` to
`real`. Each role then requires both its own gate and an exact comma-separated
E.164 destination allowlist:

```text
DINELINE_ALLOW_REAL_INTAKE_CALLS=true
DINELINE_ALLOWED_INTAKE_PHONES=+12025550109

DINELINE_ALLOW_REAL_CALLS=true
DINELINE_ALLOWED_BOOKING_PHONES=+12025550143
```

The example values are standards-reserved fictional numbers and will not make a
useful live call. Replace a value only with a destination you own or have
explicit permission to call. Do not commit `.env.local`.

Arming one role does not arm the other. A destination is checked again inside
the real provider immediately before CALL-E dispatch, so a browser-supplied
number cannot bypass the policy.

CALL-E accepts a constrained JSON Schema subset for structured call results.
The wire contracts use only supported primitive fields, enums, arrays, and
descriptions. Explicit `unknown`, `none`, and `0` sentinels are normalized into
DineLine's stricter nullable domain values before verification.

In real mode, the browser reveals a controlled test-line field and hides the
fixture-only outcome selector and sample-request shortcut. The field does not
grant permission: Agent Jake can call it only when the exact E.164 number is
also present in `DINELINE_ALLOWED_BOOKING_PHONES`. His task tells the recipient
that this is a controlled demonstration and asks the authorized participant to
role-play the restaurant.

## Safety contract

- Never commit API keys or private phone numbers.
- Keep fixture mode selected until a specific controlled call is approved.
- Each real agent has its own server-side allow gate.
- Each real agent has its own exact server-side destination allowlist.
- Call only an owned or explicitly authorized destination during development.
- Preview and approve the exact booking contract before Agent Jake can run.
- Reserve the idempotency key before provider dispatch.
- Never retry an ambiguous call automatically.
- Treat contradictions or weak evidence as uncertain, never confirmed.

## Side effects, cancellation, and rollback

Fixture mode has no external side effects. Real mode creates one outbound phone
call only after the applicable consent or booking approval passes. There are no
recurring jobs.

Before dispatch, cancel by leaving fixture mode enabled, closing the role's
gate, or stopping the local server. After dispatch, inspect or cancel the call
through CALL-E using its returned call ID. If the local result is uncertain,
reconcile that call instead of retrying it. To roll back the integration, stop
the isolated server and leave both imported n8n workflows inactive; the original
DineLine repositories are not modified by this app.

See [the architecture](docs/ARCHITECTURE.md) for the complete data flow and
security boundaries, and [the provenance record](docs/PROJECT_PROVENANCE.md)
for the existing-project timeline and authorship distinction.
