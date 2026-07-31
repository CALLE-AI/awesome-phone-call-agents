# Goal and Result Shapes

CALL-E is goal-driven: each call takes a natural-language goal plus a JSON Schema for
the structured result. The waterfall builds one goal per candidate from the same
template.

## Goal Template

Name who is calling, who is being called, the single opening, and ask for a clear
yes or no. Instruct the agent how to treat voicemail explicitly.

```text
You are calling on behalf of {requester} to reach {candidate_name}, who is on the
{list_kind} (waitlist / on-call rotation / staff roster). {opening_description} has
just become available: {opening_details}. Ask if they would like to take it. If they
say yes, confirm it is now theirs. If they decline or are unsure, thank them and let
them know they stay on the list. Be brief and polite. Do not give medical, legal, or
financial advice. If you reach voicemail, do NOT book anything; leave a short message
and report accepted as no.
```

Example, filled in:

```text
You are calling on behalf of Riverside Dental Clinic to reach Elena Petrova, who is
on the waitlist. An appointment slot has just opened up: Sunday, August 2 at 1:00 PM
(Check-up). Ask if they would like to take this slot. If they say yes, confirm it is
now booked for them. ...
```

## Result Schema

Keep the schema minimal and make the decisive field required and enum-typed, so an
ambiguous conversation cannot produce an ambiguous booking:

```json
{
  "type": "object",
  "required": ["accepted"],
  "additionalProperties": false,
  "properties": {
    "accepted": {
      "type": "string",
      "enum": ["yes", "no"],
      "description": "Whether the candidate accepted the opening. Voicemail or uncertainty counts as no."
    },
    "reason": {
      "type": "string",
      "description": "Brief reason if they declined. Empty otherwise."
    }
  }
}
```

## Reading the Result

- The call's terminal status must be `completed` AND `structuredResult.accepted`
  must equal `"yes"` to count as an acceptance.
- `failed`, `canceled`, a timeout, voicemail, or `accepted: "no"` are all declines
  for this run.
- Record the per-candidate outcome (status + accepted value + reason) so the final
  report can show the full calling history.

## Per-Route Notes

- **MCP** (`plan_call` → `run_call` → `get_call_run`): plan and run one candidate's
  call, poll `get_call_run` to terminal status, read the structured result, then and
  only then move to the next candidate.
- **SDK** (`@call-e/calle`): `client.calls.create(...)` then
  `client.calls.waitForResult(...)` (or `createAndWait`) per candidate. The blocking
  wait is what enforces the sequential guarantee — do not fire the next create while
  one is pending.
- Use an idempotency key per (opening, candidate) pair, such as
  `waterfall_{opening_id}_{candidate_id}`, so a crashed-and-resumed run cannot dial
  the same candidate twice.
