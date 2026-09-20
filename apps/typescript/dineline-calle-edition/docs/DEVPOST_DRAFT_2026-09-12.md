# DineLine CALL-E Edition: Devpost Draft

Finalized September 13, 2026 for claim-safe publication. Replace the public
link and account-email placeholders only after those artifacts are verified.

## Project name

DineLine CALL-E Edition

## Tagline

Two CALL-E agents turn a dinner idea into one approved, evidence-checked
restaurant call.

## Target prize

Most Practical Use Case

## Built with

- CALL-E TypeScript SDK
- TypeScript
- Node.js
- n8n
- Google Places API
- Zod
- Vitest
- Vercel

## Inspiration

I first built DineLine in April 2026 for my ODSC AI Engineering Accelerator
capstone, then rebuilt it over Memorial Day weekend as a reusable voice-agent
workflow. The problem stayed the same: restaurant discovery is useful, but the
last mile still ends with a person making a phone call.

For the CALL-E Hackathon, I wanted to rebuild that final loop natively around
CALL-E and make every handoff inspectable. The goal was not another chatbot that
lists restaurants. It was a system that could hear a real dinner request, help
the user choose, make exactly one approved call, and report only what the
conversation actually established.

## What it does

DineLine uses two CALL-E agents with different jobs.

The DineLine Concierge calls the diner and asks naturally about location,
cuisine, date, time, party size, budget, atmosphere, and dietary needs. Its
structured result is checked against call evidence before it can move forward.
Because CALL-E executes each phone task asynchronously, that call ends before
discovery begins. The app is the handoff between the two agents: the generated
n8n integration validates the request, searches Google Places, ranks five
choices, and caches the exact result set when configured with live credentials.
The public walkthrough uses fictional fixtures; one separately authorized live
Google Places request returned and ranked five options through the same request
and ranking contract.

The diner chooses one restaurant and reviews a readable booking contract. That
contract binds the restaurant, destination, date, time, party size, guest, and
call rules to a stable fingerprint. Only after explicit approval may Agent Jake
call the restaurant. DineLine compares CALL-E's state, structured result,
confidence, transcript evidence, and the approved contract before it reports a
reservation as booked.

If the call is unclear, times out, reaches voicemail, or produces conflicting
evidence, DineLine says so. It does not manufacture a confirmation or retry a
call that may already have happened.

## How I built it

I used the official `@call-e/calle` TypeScript SDK for both phone-agent roles.
Each role has its own task, result schema, server-side enable switch, destination
allowlist, and idempotency journal.

Zod validates local dates, times, IANA time zones, E.164 numbers, intake
preferences, booking contracts, and n8n handoffs. SHA-256 fingerprints bind
approval to the exact action. The journal reserves the idempotency key before
provider dispatch, and an ambiguous dispatch is permanently blocked from
automatic retry.

The generated n8n workflow performs the orchestration and Google Places path.
It accepts only a selected result ID and recovers the restaurant from its own
cache instead of trusting a browser-supplied phone number.

The public interface is deliberately fixture-only. It exercises the same
contracts, fingerprints, journals, unhappy paths, and evidence verifiers with
fictional restaurants and standards-reserved phone numbers. The Vercel adapter
overwrites every runtime call setting so a public visitor cannot place a call or
consume credits.

## Significant update during the submission period

DineLine V1 and V2 predate the CALL-E submission period. This edition is a
substantial new implementation completed during the hackathon:

- Replaced the Vapi runtime with two native CALL-E SDK providers
- Added a CALL-E diner-intake agent as a separate role
- Added strict structured schemas and evidence verification for both calls
- Added immutable approvals, correlation IDs, and two idempotency journals
- Added fail-closed timeout and contradiction handling
- Added separate real-call gates and exact destination allowlists
- Added a sanitized native n8n integration with no Vapi dependency
- Added a new responsive interface, fixture-only hosted adapter, and automated
  test suite

The original concept and authorship are unchanged. I designed and built the
original DineLine agents, prompts, tools, webhooks, and n8n nodes. I used Codex
as an implementation partner to help engineer, test, document, and package this
CALL-E-native edition under my direction.

## Challenges

The hardest problem was not starting a phone call. It was deciding when the
software had enough authority to start one and enough evidence to describe the
result honestly.

Phone calls are irreversible side effects. A network timeout does not prove a
call never started, so retrying automatically could create a duplicate booking.
Likewise, a provider summary that sounds positive is not enough to claim a
reservation. Those constraints shaped the approval fingerprint, reserve-before-
dispatch journal, non-retryable unknown state, and evidence verifier.

## Accomplishments

- Built two native CALL-E roles with independent permissions
- Preserved one exact human approval across browser, n8n, and provider metadata
- Added visible confirmed, unavailable, alternative, voicemail, contradiction,
  timeout, and duplicate outcomes
- Completed n8n fixture execution `879` through both agent boundaries with the
  final assertion marked `passed`
- Completed a controlled CALL-E Agent 1 call on an owned line that captured a
  complete dinner request in clear English with `0.93` provider confidence and
  no missing search fields
- Completed a separate controlled Agent Jake call on the same owned line while
  role-playing the restaurant; CALL-E returned a confirmed outcome and
  DineLine's verifier accepted it without human review
- Exercised the Google Places request and ranking contract once against the live
  API, returning HTTP 200 and five ranked options
- Verified the fixture journal boundary in the browser: an exact retry in the
  same session is blocked, while a fresh sample session can run normally
- Preserved accepted call IDs and added read-only exact-call reconciliation so
  a slow result cannot trigger a duplicate call
- Passed 65 automated tests, TypeScript compilation, the upstream repository
  validator, JavaScript syntax validation, and an npm audit with zero known
  vulnerabilities
- Produced and frame-reviewed a 2 minute 49.6 second English demo at 1080p with
  small burned-in captions, a separate SRT file, and no private account data
- Kept the original DineLine repositories untouched

## What I learned

The most useful agent architecture is often not the one with the most autonomy.
Separating discovery, choice, approval, action, and verification made the
workflow easier to reason about and safer to reuse.

I also learned that structured output is a claim, not proof. For consequential
phone work, the application still needs to compare that claim with the task,
provider state, confidence, transcript evidence, and the user's approved
constraints.

## What's next

The same pattern can support more than restaurant reservations:

`Understand -> Discover -> Decide -> Approve -> Call -> Verify -> Return`

On the business side, it becomes intake, qualification, scheduling, routing,
and follow-up. I am already applying that pattern to CaseCapture, a separate
three-agent legal-intake prototype. Longer term, DineLine can also face the
restaurant side and help receive, validate, and route reservation requests.

## Judge testing instructions

1. Open `https://dineline-calle-edition.vercel.app` on desktop or mobile.
2. Select **Skip the call and use the sample request**.
3. Inspect the evidence-backed dinner request and five fictional choices.
4. Choose one restaurant.
5. Review the exact booking contract and approve it.
6. Run the Agent Jake demo call and inspect the evidence-backed fixture outcome.
7. Select **Try the same call again** and confirm that a second call is blocked.
8. Select **Start over**, load the sample request again, and confirm that a new
   fixture session can complete normally.
9. Start a fresh sample and choose an unavailable, alternative, voicemail,
   contradiction, or timeout scenario to inspect a fail-closed path.

The public app cannot make real calls. The source contribution contains both
native CALL-E providers and the fixture-only hosted adapter. The final public
video shows the complete staged fixture path and accurately describes the two
separate owned-line CALL-E canaries. It does not claim that the entire live
round trip was executed as one continuous conversation.

## Links to fill after approval

- Public demo: `https://dineline-calle-edition.vercel.app`
- Public video under three minutes: `[YOUTUBE_OR_VIMEO_URL]`
- Required upstream pull request: `[CALL_E_PR_URL]`
- CALL-E account email: `[ACCOUNT_EMAIL]`

## Official requirements checked

- https://call-e.devpost.com/rules
- https://call-e.devpost.com/
- https://github.com/CALLE-AI/awesome-phone-call-agents
