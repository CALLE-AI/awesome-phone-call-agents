---
name: logistics-exception
description: Resolve a delayed-shipment dock exception by phone with CALL-E. Calls the driver and receiving dock concurrently with one strict result schema, reconciles terminal results, combines only supported facts into a recovery card, and leaves any call that changes the dock appointment to explicit human approval.
license: MIT
---

# Logistics Exception

Use this skill when an operations desk has a shipment that missed its promised dock window and the missing facts (truck location, real reason, revised ETA, whether the dock will still receive) are only available by phone from people the desk is authorized to call.

The skill is the reusable core of [DockSignal](https://github.com/HectorTa1989/docksignal): a call plan per contact role, a strict `recipient_result_schema`, an idempotency and webhook contract, and a deterministic rules table that turns provider-backed results into one recovery decision.

## When To Use

- A dock, receiving, or delivery appointment has been missed or is about to be missed
- The operator has an existing relationship with the driver, carrier dispatch, and receiving contact and is authorized to call them
- The desired output is a verified recovery card and, at most, one approval-gated follow-up call to request a dock exception or a new slot

## When Not To Use

- Cold outreach, marketing, or collections
- Emergency, medical, legal, or financial calls; never call emergency services
- Calling a number the operator did not supply and authorize
- Automatically confirming, moving, cancelling, or pricing an appointment; that is always a separate human decision
- Any workflow that needs a call to be cancelled after dispatch (the CALL-E Calls API has no cancel endpoint; keep waves small)

## Required Inputs

- `incident_id`: stable workflow identity, for example `DS-1042`
- `shipment_ref`, `cargo_description`, `promised_dock_at` (ISO-8601), `timezone` (IANA)
- `last_known_location`: what tracking last showed, offered to the assistant as context, never asserted
- `receiving_cutoff_at`: optional cutoff on file; a dock-stated cutoff overrides it
- `org_name`: the organisation the AI assistant says it is calling for
- `contacts[]`: `role` (`driver`, `dispatcher`, `receiving_dock`), `name`, `phone_e164`, `authorization_note`, `include`
- `authorization_confirmed`: must be true, recorded with the confirming operator

See `assets/sample-incident.json` for a fictional example using NANP test-range numbers.

## Preflight

1. Validate every phone as E.164 (`^\+[1-9]\d{6,14}$`) and reject emergency-number patterns.
2. Show the operator each recipient, the goal, the questions, the boundaries, and the exact task text before any call.
3. Derive one idempotency key per incident and contact: `docksignal:{incident_id}:{contact_id}:fact_finding:v1`. Persist the call task row with that key before calling CALL-E.
4. Refuse to dispatch without `authorization_confirmed: true` and a valid server-side `CALLE_API_KEY`. There is no dry-run that fabricates a result; preview is the inspectable plan, and `scripts/validate-result.mjs` checks results offline.

## CALL-E Task Templates

Driver (fact-finding):

```text
You are an AI assistant calling on behalf of {org_name}. Say this in your first sentence.
You are calling about shipment {shipment_ref} ({cargo_description}), due at the receiving dock at {promised_dock_local} and now late.
You are calling {driver_name}, the driver. Confirm you are speaking with the driver for this load.
Ask: 1) where the truck is right now; 2) what caused the delay; 3) the exact clock time they expect to arrive (ask for a specific time, not a range; if a range, ask for the latest time); 4) what they will do next.
Record the arrival time exactly as stated; if only a vague estimate is given, leave it empty. Do not give routing instructions, promise a dock appointment, or discuss fees.
If voicemail or a wrong number, say a human operator from {org_name} will follow up and end the call.
```

Receiving dock (fact-finding):

```text
You are an AI assistant calling on behalf of {org_name}. Say this in your first sentence.
You are calling {dock_contact} at the receiving dock about shipment {shipment_ref}, which missed its {promised_dock_local} window.
Ask: 1) whether the slot is still held; 2) the latest arrival clock time today at which the dock can still accept this load; 3) the options if the truck is later than that; 4) who can approve an exception or new slot.
Record the latest acceptable time exactly as stated; if none is given, leave it empty. Do not book, confirm, move, or cancel any appointment and do not agree to fees; say a human operator will call back to confirm anything that changes the appointment.
```

Receiving dock (follow-up, only after a human approval is recorded):

```text
... A human operator, {approver}, at {org_name} has approved this request. The driver now expects to arrive at {revised_eta}. Earlier the dock said: "{dock_constraint}".
Ask whether the dock can accept the load at {revised_eta} as an exception, or the earliest alternative window, any conditions, and who will expect the truck.
Record any offered window as an exact clock time. If the dock mentions fees or penalties, record them and say the operator will confirm; do not agree to any charge. Never state that anything is confirmed unless the dock explicitly says so.
```

## Structured Result

Send `references/result-schema.json` as `recipient_result_schema` on every call. Field semantics:

```json
{
  "contact_role": "driver | dispatcher | receiving_dock | unknown",
  "reached": "yes | no | unknown",
  "shipment_recognized": "yes | no | unknown",
  "current_status": "free text, empty if not stated",
  "revised_eta": "exact clock time as stated ('16:40', '4:40 PM'); for the dock: its latest acceptable arrival time; empty if vague",
  "can_accept": "yes | no | conditional | unknown (dock and follow-up only)",
  "blocker": "delay reason or acceptance constraint, empty if none",
  "next_action": "what the contact will do or asked for, empty if none",
  "certainty": "high | medium | low | unknown"
}
```

Empty strings and `unknown` are unresolved. Only results from `completed` calls with `reached = yes` may become facts. `null` recipient results (`call.result_validation_failed`) and `call.failed` never do.

## Reconciliation Contract

1. Persist the returned `call_task.id` immediately, unique per task.
2. Receive `call.completed`, `call.failed`, `call.result_validation_failed` at one HTTPS endpoint. Require `CALL-E-Event-Id` and reject when it differs from the body `id`.
3. Store the event id before any side effect; a repeated id is a no-op.
4. Fetch `GET /v1/calls/{call_id}` with the server key and apply that snapshot, not the webhook body.
5. Poll open calls periodically as a safety net; never regress a terminal task on a stale non-terminal snapshot.

## Decision Rules

| Condition (facts from reached contacts only) | Branch | Action | Needs human |
| --- | --- | --- | --- |
| No usable result yet | awaiting_results | wait | – |
| Driver and dispatcher ETAs differ | eta_conflicted | resolve manually; never pick one | yes (manual) |
| ETA is not an exact clock time | eta_unresolved | obtain exact ETA; never infer from vague speech | yes (manual) |
| Dock `can_accept = no` | dock_declined | follow-up call: earliest alternative slot | yes (approval before call) |
| ETA later than dock-stated (or intake) cutoff | window_missed | follow-up call: request exception or new slot; notify dispatcher | yes (approval before call) |
| ETA within cutoff and dock yes/conditional | within_window | driver calls dock 30 min out; confirm any condition | – |
| Dock not reached / cutoff unknown | dock_unresolved / cutoff_unknown | reach dock manually | yes (manual) |
| Follow-up `can_accept` yes/conditional | exception_granted | record window, brief driver, close | – |

Confidence is the minimum of the used contacts' `certainty` and CALL-E `completion_confidence`, lowered when the cutoff came from intake or a key fact is unresolved. Every displayed fact carries its call id and evidence; see `references/examples.md`.

## Cancellation And Idempotency

Idempotency keys are per incident and contact and are reused on every retry; concurrent launches race on a single database row claim. There is no cancellation after dispatch, so launch only the two or three contacts the operator confirmed and never auto-launch a second wave. Ambiguous or missing results route to a human; do not retry automatically.

## Safety Notes

Read `references/safety.md` before placing a live call. Phone numbers must be masked in summaries and logs; the full number appears only in the operator's pre-dispatch confirmation.
