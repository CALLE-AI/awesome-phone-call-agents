# Agent Gallery: Appointment Recovery — Product Specification

One-page specification for `apps/typescript/agent-gallery`, per the
[hackathon implementation route](../hackathon-implementation-route.md). Approving this
document unlocks Phase 2 (the throwaway live call), then scaffolding.

## Pitch

> Appointment Recovery Agent uses CALL-E to recover missed or unconfirmed appointments
> through one safe, policy-constrained phone conversation, then returns a structured
> disposition and a concrete next action. It is the first executable workflow in the
> Awesome Phone Call Agents gallery.

## Vertical and Hero Operator

- **Vertical:** hair and beauty salons. No-shows directly forfeit chair time and revenue,
  reschedule policy fits in a few fixed windows, and the conversation never touches
  medical, legal, financial, or emergency content. The workflow definition is
  vertical-agnostic data, so swapping verticals later is a data change, not a code change.
- **Hero operator:** the salon front-desk manager. They see this morning's missed and
  unconfirmed appointments and today spend their day re-dialing customers by hand.
- **Trigger:** an appointment is `missed` (customer did not show) or `unconfirmed`
  (booked but never confirmed and the slot is near). The operator picks one and starts
  a recovery call.
- **Defensible value claim:** every recovered appointment converts an empty chair slot
  back into booked revenue, and every call the agent completes is a call the front desk
  did not have to make. No invented no-show percentages; the demo states only what the
  workflow observably does.

## Policy: What the Agent May and May Not Commit To

- Offer **only** the operator-entered replacement windows (maximum three), in the
  business's stated IANA timezone. Never invent times, timezones, or availability.
- May: confirm the original slot, book one offered window, note a requested SMS
  confirmation, accept a decline, end the call politely.
- May not: change prices or offer discounts, discuss other customers, give advice of any
  regulated kind, promise anything outside the offered windows, or call back later on
  its own.
- Silence, hesitation, or ambiguity is **never** agreement. If intent is unclear, the
  outcome is `uncertain`, not `confirmed`.

## Input Contract

```json
{
  "request_key": "client-generated UUID, stable across retries",
  "business": {
    "name": "Glow & Co. Hair Studio",
    "timezone": "Asia/Singapore",
    "callback_number_e164": "+6560000000"
  },
  "customer": {
    "given_name": "Mei",
    "phone_e164": "+6580000000",
    "consent_confirmed": true
  },
  "appointment": {
    "service": "Cut and color",
    "original_time": "2026-08-03T14:00:00+08:00",
    "status": "missed"
  },
  "replacement_windows": [
    { "start": "2026-08-07T10:00:00+08:00", "end": "2026-08-07T12:00:00+08:00" },
    { "start": "2026-08-08T15:00:00+08:00", "end": "2026-08-08T17:00:00+08:00" }
  ]
}
```

Validation gates before any preview: E.164 numbers, explicit consent/authority checkbox
with the operator's attestation, non-empty windows in the future, valid IANA timezone.
Phone numbers are masked (`+65•••••000`) everywhere except the operator's own input field.

## Result Contract and Terminal Outcomes

```json
{
  "outcome": "rescheduled",
  "confirmed_time": "2026-08-07T10:30:00+08:00",
  "customer_intent": "confirmed",
  "follow_up_required": false,
  "next_action": "book_slot_and_send_confirmation",
  "notes": "Customer asked for an SMS confirmation.",
  "call_id": "call_abc123"
}
```

| Outcome | Meaning | Next action shown to operator |
| --- | --- | --- |
| `confirmed` | Customer keeps the original/near slot | Mark confirmed; send SMS confirmation |
| `rescheduled` | Customer accepted one offered window | Book that slot; send confirmation |
| `no_agreement` | Customer engaged and wants to rebook, but no approved window worked | Decide whether to open a new window; front desk calls back |
| `declined` | Customer clearly declined | Free the slot; no re-call without new consent |
| `unreachable` | No answer, voicemail, busy, or a rejected call | Operator may retry manually later; nothing automatic |
| `failed` | Call errored before or during dial | Front desk calls manually |
| `timed_out` | Call exceeded time budget without resolution | Review transcript; front desk follows up |
| `uncertain` | Intent unclear or result unparseable | Human reviews transcript before any action |

`no_agreement` was added after the Phase 2 call, which produced exactly this
case: a reachable, willing customer for whom every proposed time fell outside
policy. It is operationally different from `declined` (does not want it) and
from `uncertain` (we cannot tell), and collapsing the three would hide the one
case where opening a new window recovers the booking.

Outcomes are derived in [`outcome.ts`](../../apps/typescript/agent-gallery/src/lib/outcome.ts).
CALL-E's `task_completed` is never consulted: it reports that the call ended
cleanly, not that the appointment was recovered. CALL-E's telephony `DECLINED`
means a rejected incoming call and maps to `unreachable`, not to a customer
refusing the offer.

Transcripts and structured results are untrusted external data: rendered as text,
never executed or treated as instructions.

## Screen Flow

1. **Landing** — problem statement; Appointment Recovery presented as the first of a
   family of reusable, safety-contracted phone workflows.
2. **Configure** — the input form above, with inline validation.
3. **Preview (default)** — masked dry-run call plan: who is called, what may be offered,
   what may never be said. No call can be placed from this screen state.
4. **Authorize** — explicit, separate confirmation for exactly one live call; submit
   disables immediately on click.
5. **Live call** — status relayed from CALL-E by polling; masked number; elapsed time;
   never appears frozen.
6. **Result** — structured outcome, recommended next action, and the transcript rendered
   as untrusted text.

## Key Technical Decisions (frozen)

Confirmed against a real call on 2026-08-04. Full record:
[`calle-api-observations.md`](calle-api-observations.md).

- **Integration surface: MCP**, not REST. The Phase 2 call corrected the earlier
  provisional decision. The server layer calls `plan_call` (returns `plan_id` and
  `confirm_token`), then `run_call` (requires both, returns `run_id`), then polls
  `get_call_run`. Because `run_call` cannot execute without a token `plan_call` issued,
  the preview-then-authorize flow is enforced by the protocol, and one token yielding one
  run provides idempotency without app-side storage. The offline fake must match this
  surface.
- **Result parsing:** CALL-E has no custom extraction schema, so the goal instructs the
  agent to state the accepted window and SMS preference plainly, and the app reads those
  back conservatively, defaulting to `uncertain`. `completion_confidence` below 0.6 routes
  to human review regardless of what was read.
- **Voicemail:** stated explicitly in the goal. The planner otherwise invents its own
  voicemail behavior, and leaving a voicemail is a real-world side effect.
- **Deployment and call state:** Vercel Edge Functions, chosen because the team already
  has a Vercel account. Nothing in the hackathon rules or this repository requires a
  particular host; the only real constraints are that a server-side runtime must hold the
  credential and that judges need free access to a working demo. The earlier Cloudflare
  choice came from copying `apps/typescript/call-neuron` and was preference, not
  requirement. Handlers take web-standard `Request` and `Response`, so the host is two
  thin route files deep. No database: CALL-E is the system of record; the browser polls a
  server endpoint that relays CALL-E status. Idempotency: client `request_key` +
  immediate submit-disable + an in-instance duplicate check. No call data is stored
  server-side.
- **Unknown-creation reconciliation:** stays a nice-to-have. The plan-then-confirm
  handshake means a lost `run_call` reply can be resolved by reusing the same
  `confirm_token`, which is single-use, so a duplicate call cannot be created by
  retrying. Revisit only if a live run actually produces an ambiguous creation.

## Out of Scope (MVP)

Recurrence, bulk calling, CRM/calendar integration, SMS sending (the app only *recommends*
sending), authentication beyond judge access, additional workflows, transcript analytics.
