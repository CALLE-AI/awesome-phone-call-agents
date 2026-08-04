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
| `declined` | Customer clearly declined | Free the slot; no re-call without new consent |
| `unreachable` | No answer / voicemail | Operator may retry manually later; nothing automatic |
| `failed` | Call errored before or during dial | Front desk calls manually |
| `timed_out` | Call exceeded time budget without resolution | Review transcript; front desk follows up |
| `uncertain` | Intent unclear or result unparseable | Human reviews transcript before any action |

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

- **Integration surface:** CALL-E REST API/SDK from the server-side layer. The `calle`
  CLI is used on Day 1 for the throwaway call to observe real creation semantics, status
  transitions, and result payloads. The offline fake must match this same surface.
- **Deployment and call state:** Cloudflare Pages + Pages Functions (copying
  `apps/typescript/call-neuron`'s working pipeline). No database: CALL-E is the system
  of record; the browser polls a server endpoint that relays CALL-E status. Idempotency:
  client `request_key` + immediate submit-disable + server-side duplicate check before
  creation. No call data is stored server-side.
- **Unknown-creation reconciliation:** provisionally in scope pending Day 1 findings.
  `apps/typescript/phone-approval-gate` already reconciles unknown creation outcomes
  against the fake CALL-E, which suggests the API can lose the creation reply. If the
  Day 1 throwaway call confirms this, promote reconciliation from nice-to-have to
  required; otherwise ship stable idempotency plus a clear `failed` state.

## Out of Scope (MVP)

Recurrence, bulk calling, CRM/calendar integration, SMS sending (the app only *recommends*
sending), authentication beyond judge access, additional workflows, transcript analytics.
