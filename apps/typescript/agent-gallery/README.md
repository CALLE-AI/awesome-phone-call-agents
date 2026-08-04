# Agent Gallery — Appointment Recovery

Recover a missed or unconfirmed appointment through one safe, policy-constrained
CALL-E phone call, and get back a structured disposition with a concrete next
action instead of a raw transcript.

Appointment Recovery is the first workflow in a planned family of reusable,
safety-contracted phone workflows. The product specification lives at
[`docs/agent-gallery/product-spec.md`](../../../docs/agent-gallery/product-spec.md).

## Status

The offline flow (configure → validate → masked dry-run preview → authorization
gate) works end to end, outcome classification is implemented and tested, and
the CALL-E MCP client is written and covered against a fake server.

It has not yet been exercised against the live service from a deployed
environment: that is the next step, and it needs `CALLE_ACCESS_TOKEN` and
`CALLE_SERVER_URL` set on the deployment. Without those the app runs and
previews normally and the call endpoint answers `503 not_configured`.

The integration surface was confirmed against a real call; see
[`calle-api-observations.md`](../../../docs/agent-gallery/calle-api-observations.md).

## Architecture and reuse

The code is split so that the CALL-E integration can be lifted into a different
workflow without carrying appointment concepts with it.

```text
api/                                deployment surface
├── _lib/calls.ts                   handlers on web-standard Request/Response
└── calls/                          thin Vercel Edge route files

src/calle/                          reusable, workflow-agnostic
├── client.ts                       MCP transport: plan_call, run_call, get_call_run
├── status.ts                       run-status semantics and delivery classification
└── mask.ts                         phone-number masking

src/workflows/appointment-recovery/ this workflow only
├── workflow.ts                     policy lists and the call goal
├── types.ts                        request, result, and outcome contracts
├── validate.ts                     input rules
├── agreement.ts                    reads what an answered call agreed to
├── outcome.ts                      delivery and agreement to business outcome
└── result.ts                       operator-facing result
```

`src/calle/` may not import from `src/workflows/`, and it does not name any
appointment concept. Both rules are enforced by `test/layering.test.ts` rather
than left to good intentions, because the dependency inverts quietly the first
time the adapter needs a domain constant.

The split falls where knowledge actually differs. Which statuses are terminal,
and the fact that a telephony `DECLINED` is a rejected call rather than a person
saying no, are things every CALL-E workflow must get right, so they live in the
adapter. Whether a given call recovered an appointment is only meaningful here.

A second workflow would supply its own goal text, input contract, and reading of
what the call agreed to, and reuse the adapter unchanged. It would not get a
gallery UI for free: the screens are written against this workflow's contract.

## The problem and workflow boundary

Missed and unconfirmed appointments cost service businesses (the reference
vertical is hair and beauty salons) chair time and revenue, and recovering them
means staff re-dialing customers by hand. This app places exactly one outbound
recovery call per explicit authorization. It does not do bulk calling,
recurrence, SMS sending, or calendar writes; it recommends the next action and a
person performs it.

The agent may only confirm the original slot, offer the operator-entered
replacement windows (maximum three), book one of them, note a requested SMS
confirmation, or accept a decline. It may never change prices, discuss other
customers, give regulated advice, promise anything outside the windows, or call
back on its own. Silence and ambiguity are never treated as agreement.

## Setup and usage

```bash
npm install
npm run dev        # local UI at the Vite dev URL
npm run verify     # typecheck + tests + build
```

Deploy with `npm run deploy` (Vercel). The API routes under `api/` run on
Vercel's Edge runtime, but the handlers themselves take and return web-standard
`Request` and `Response`, so moving to another host means replacing two thin
route files rather than rewriting the integration.

## Credentials and their boundary

CALL-E credentials are supplied only as Vercel environment variables
(`CALLE_ACCESS_TOKEN`, `CALLE_SERVER_URL`) read by the handlers in `api/_lib/`.
No credential is ever bundled into browser code, committed, or pasted into chat.
Set the token so its value never appears in a shell argument or history:

```bash
npx vercel env add CALLE_ACCESS_TOKEN production
```

The `confirm_token` that authorizes one call is also server-only: it is created,
spent, and discarded inside a single request and never sent to the browser.
Local live testing uses an untracked `.env.local`.

## Dry-run and preview behavior

Dry run is the default and is the entire flow until the final gate. The preview
screen shows the complete call plan — masked recipient number, business context,
offered windows, and the agent's may/may-never lists — without any network call.

## Real-world side effects

Exactly one outbound phone call, and only after the operator checks an explicit
"I authorize exactly one call to this number, now" box and presses the button,
which disables immediately. Duplicate submissions with the same `request_key`
return the already-created call instead of dialing again.

## Input and output contracts

See [`src/types.ts`](src/types.ts). Input: business (name, IANA timezone, E.164
callback number), customer (given name, E.164 phone, consent attestation),
appointment (service, ISO 8601 original time, missed/unconfirmed status), and up
to three future replacement windows, plus a client-generated `request_key`.
Output: one of eight terminal outcomes (`confirmed`, `rescheduled`,
`no_agreement`, `declined`, `unreachable`, `failed`, `timed_out`, `uncertain`),
an optional agreed time, customer intent, notes, the CALL-E call id, and a
mapped next action.

Outcomes are derived in [`src/lib/outcome.ts`](src/lib/outcome.ts) from the
call's terminal status and a conservative reading of the conversation produced
by [`src/lib/agreement.ts`](src/lib/agreement.ts). That reader treats the
summary and transcript as untrusted text, requires positive evidence for every
conclusion, and returns "inconclusive" when signals conflict or when an
acceptance names no offered window, so ambiguity reaches a human. CALL-E's
`task_completed` is deliberately never used as the business outcome: it reports
that the call ended cleanly, including calls that recovered nothing. CALL-E's
telephony `DECLINED` means a rejected incoming call and maps to `unreachable`,
not to a customer refusing the offer.

Call transcripts and structured results are untrusted external data. The UI
renders them as plain text and never executes or obeys anything inside them.

## Cancellation, rollback, and cleanup

The flow creates no recurring jobs and stores nothing server-side, so there is
nothing to clean up after a run. Before the authorization gate, closing the tab
abandons the draft. Once a call is placed it cannot be recalled; the operator
follows the recommended next action, and an `uncertain` outcome always routes to
human review before anything else happens.

## Data and log storage

No database. CALL-E is the system of record for call state; the browser polls a
server endpoint that relays CALL-E's own status. Results exist only in CALL-E
and the operator's browser session. The server function logs nothing beyond
Vercel's standard request handling and never logs phone numbers.

## Tests and verification

```bash
npm test
```

Tests cover E.164 and timezone validation, consent and window rules, number
masking, outcome classification, the MCP client against an in-process fake
CALL-E server, and the layering boundary described above. Two are regression
tests for defects that reached working code: CALL-E reporting
`task_completed: true` at high confidence on a call that rebooked nothing, and
classifying a result without the offered windows, which downgraded every
successful reschedule to `uncertain`.

Tests run offline with no credentials and place no calls. `npm run verify` adds
the typecheck and production build.

## Opt-in live calls

Not yet available in the scaffold. When the live layer lands, live calling will
require server-side credentials plus the per-call authorization gate; without
credentials the app remains fully usable in dry-run form.

## Current limitations

- The CALL-E client has been verified against a fake server, not yet against the
  live service from a deployment.
- The duplicate guard holds request keys in one server isolate. Planning and
  running happen in a single request, so a repeat submission would mint a fresh
  single-use token and dial again; the guard plus the disabled submit control
  covers a double-click, not a determined retry across cold starts. Durable
  storage is the only complete answer and is out of scope for one call.
- The agreement reader matches phrasing rather than understanding language. It
  handles negation and split sentences, but wording it does not recognize reads
  as inconclusive, which sends a correctly handled call to human review as
  `uncertain`. It errs toward review rather than toward a wrong booking.
- The duplicate guard is per-isolate; the completed implementation relies on the
  single-use `confirm_token` for real protection.
- Replacement-window times are entered in the business's local time without
  cross-checking the stated timezone.
- Single workflow, single call, English-language conversations only.
