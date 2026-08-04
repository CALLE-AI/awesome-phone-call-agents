# Agent Gallery — Appointment Recovery

Recover a missed or unconfirmed appointment through one safe, policy-constrained
CALL-E phone call, and get back a structured disposition with a concrete next
action instead of a raw transcript.

Appointment Recovery is the first workflow in a planned family of reusable,
safety-contracted phone workflows. The product specification lives at
[`docs/agent-gallery/product-spec.md`](../../../docs/agent-gallery/product-spec.md).

## Status

Scaffold. The offline flow (configure → validate → masked dry-run preview →
authorization gate) works end to end. The live CALL-E integration is
intentionally stubbed: the server layer returns `501 live_integration_pending`
until the integration surface is confirmed against a real call, per the
[implementation route](../../../docs/hackathon-implementation-route.md).

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

Deploy with `npm run deploy` (Cloudflare Pages via Wrangler).

## Credentials and their boundary

CALL-E credentials are supplied only as Cloudflare Pages environment variables
(`CALLE_API_KEY`, `CALLE_BASE_URL`) read by the server function in
`functions/api/`. No credential is ever bundled into browser code, committed, or
pasted into chat. Local live testing will use an untracked `.dev.vars` file.

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
Output: one of seven terminal outcomes (`confirmed`, `rescheduled`, `declined`,
`unreachable`, `failed`, `timed_out`, `uncertain`), an optional agreed time,
customer intent, notes, the CALL-E call id, and a mapped next action.

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
Cloudflare's standard request handling and never logs phone numbers.

## Tests and verification

```bash
npm test
```

Tests cover E.164 and timezone validation, consent and window rules, and number
masking. They run offline with no credentials and place no calls. `npm run
verify` adds the typecheck and production build.

## Opt-in live calls

Not yet available in the scaffold. When the live layer lands, live calling will
require server-side credentials plus the per-call authorization gate; without
credentials the app remains fully usable in dry-run form.

## Current limitations

- The live CALL-E client is stubbed (`501 live_integration_pending`).
- The duplicate guard is per-isolate; the completed implementation must also
  check CALL-E's call list before creating.
- Replacement-window times are entered in the business's local time without
  cross-checking the stated timezone.
- Single workflow, single call, English-language conversations only.
