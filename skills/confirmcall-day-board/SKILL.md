---
name: confirmcall-day-board
description: Confirm a full day's existing appointments by phone with CALL-E. Plans one disclosed confirmation call per booking, captures yes/no/reschedule as structured JSON, and leaves calendar writes to a human. Fixture/dry-run by default.
license: MIT
---

# ConfirmCall Day Board

Use this skill when a clinic, tutor, or service desk has a **day list** of existing appointments and explicit authority to place disclosed confirmation calls. The skill turns each booking into one CALL-E confirmation task, runs them (or returns fixtures), and writes **yes / no / reschedule** results back to a board for a human.

This skill does not book, move, or cancel calendar events. A human reviews results before any diary change.

## When To Use

- Morning confirmation pass over today's booked appointments
- Capture declines and reschedule requests into structured results
- Preview every CALL-E script before any live dial
- Keep calendar authority with a human coordinator

## When Not To Use

- First-contact sales, lead qualification, or unsolicited outreach
- Medical advice, legal, financial, emergency, collections, or political calls
- Calling numbers the coordinator did not authorize
- Hidden retries, recurring campaigns, or automatic calendar writes
- Collecting payment, ID numbers, or health details on the call

## Required Inputs (per appointment)

- `request_id`: stable local identifier
- `business_display_name`: disclosed on the call
- `recipient_first_name`
- `to_phone_e164`: E.164, authorized
- `appointment.service`, `appointment.starts_at` (ISO-8601 with offset), `appointment.location`
- `timezone`: IANA
- `consent`: must be true
- `authorized_reason`: why this specific call is allowed

Optional: `reschedule_windows` (max 6 ISO-8601 times the desk can honor).

## Safety Model

1. Fixture / dry-run by default — no network, no CALL-E dial.
2. Live mode only when `CALLE_API_KEY` (or `CALL_E_API_KEY`) is set **and** the operator explicitly runs live.
3. Refuse if `consent` is not true or the number is not on the day's authorized list.
4. Mask phone numbers in logs (`+1***0100`).
5. One call plan per appointment — no silent retries.
6. Calendar remains human-owned.

## Dry-Run (no CALL-E credentials)

From the repository root:

```bash
cd apps/typescript/confirmcall-day-board
npm install
npm run fixture
```

This loads the Thursday sample board, prints planned CALL-E scripts, and writes fixture outcomes (Maya confirmed, Jordan reschedule, Eli declined).

## Live Path

1. Create a CALL-E API key in the CALL-E dashboard.
2. Export `CALLE_API_KEY`.
3. Only call numbers you are authorized to contact.
4. Run `npm run live` only after reviewing `npm run preview` scripts.

Prefer the runnable app under `apps/typescript/confirmcall-day-board` for the full day-board UX. Use this skill when an agent host should orchestrate the same workflow via CALL-E SDK/API/MCP.

## Result Shape

Each appointment returns fail-closed structured JSON:

```json
{
  "request_id": "apt-maya-1",
  "disposition": "confirmed",
  "notes": "Recipient confirmed the booked slot",
  "requested_time": null
}
```

`disposition` is one of `confirmed`, `declined`, `reschedule_requested`, `no_answer`, `failed`.

## References

- `references/call-script.md` — disclosed confirmation script template
- `assets/sample-day-board.json` — fictional Thursday board
