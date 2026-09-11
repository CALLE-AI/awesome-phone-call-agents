---
name: no-show-shield
description: Call every booking on a given day to confirm it, capture reschedule and cancellation outcomes as structured JSON, write the results back to a calendar file, and hand the operator a short list of slots that still need a human. Mock provider and preview mode by default; a hard call budget meters every real call.
license: MIT
---

# No-Show Shield

Use this skill when a solo operator — a trades business, a mobile clinic, a
single-chair salon — has explicit authority to place disclosed confirmation
calls to **the customers already booked into a given day**, and wants the
answers back as data rather than as voicemail they still have to action.

It differs from [`appointment-confirm`](../appointment-confirm/) in scope
rather than intent: that skill confirms one appointment and deliberately
leaves the diary alone. This one walks a whole day's book, applies each
outcome to a calendar file, and reports only the exceptions. Use
`appointment-confirm` when a human is reviewing every result; use this when
the operator wants an unattended evening run and a short morning list.

## What it does

1. **Sync** — loads a day's bookings from a JSON calendar file.
2. **Preview** — prints who would be called, with no calls placed. Always
   available, and the default way to check a run before it happens.
3. **Run** — places one CALL-E call per pending booking, with a
   `result_schema` of `confirmed` / `reschedule_requested` / `cancelled` /
   `no_answer` / `unknown`, plus a free-text reschedule preference.
4. **Write-back** — applies each structured outcome to the calendar file,
   preserving the customer's stated preference verbatim.
5. **Summary** — prints totals and a `Needs you:` line naming only the
   bookings a human must now handle.

## When not to use it

- Cold outreach, sales, or any call the recipient has not already transacted
  into. This skill confirms existing bookings only.
- Medical, legal, or financial advice of any kind. The agent states the
  service name and time and nothing more; it does not discuss treatment,
  diagnosis, obligations, or money.
- Emergencies or time-critical safety matters. It has no escalation path and
  must not be relied on where a missed call has consequences.
- Debt collection, or any context where a recipient may feel pressured.

## Call behaviour

The agent announces that it is an AI in its first turn, on every call. It
asks one question at a time, never argues, never tries to talk a customer out
of a change, and will not promise a new slot — a reschedule request is
recorded and handed to a human with a "we'll text to confirm" close. Wrong
number or a request not to call ends the call immediately and records the
outcome as `unknown` with a note.

See [`references/safety.md`](references/safety.md) for the full rule set and
[`references/examples.md`](references/examples.md) for runnable examples.

## Source

Reference implementation, tests, and an honest limitations section:
https://github.com/landbuild/no-show-shield
