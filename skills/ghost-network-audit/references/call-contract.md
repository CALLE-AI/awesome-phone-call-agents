# Call contract

The exact request sent to CALL-E, and the exact shape expected back.

## Endpoint

```text
POST {CALLE_BASE_URL}/v1/calls
Authorization: Bearer {CALLE_API_KEY}
Idempotency-Key: {sha256 of the payload}
```

`CALLE_BASE_URL` defaults to `https://api.heycall-e.com`. The auditor points it at the
bundled fake server for offline rehearsal.

Poll `GET /v1/calls/{id}` until `status` leaves `queued`/`in_progress`, or supply
`webhook_url` and let CALL-E post the result.

## Task text

One office, one call, however many listed clinicians share that number. Substitute the
bracketed values; never leave a bracket unfilled.

```text
You are placing a directory-verification call to a medical office on behalf of
[AUDITING_ORGANIZATION].

Open with this disclosure before anything else, and do not skip it:
"Hello, this is an automated call from [AUDITING_ORGANIZATION]. We're verifying a public
provider-directory listing for your office. This will take about a minute, and nothing
about any patient is involved. If you'd like to confirm this call is genuine, you can
reach us at [CALLBACK_NUMBER]."

Then ask only these questions, in order, about the listed clinicians:
[PROVIDER_LINES]

1. For each clinician named above, does that clinician currently practice at this
   location?
2. Does this office currently accept [PLAN_NAME]?
3. Are those clinicians accepting new patients under [PLAN_NAME]?
4. If they are accepting new patients, roughly how far out is the next available
   new-patient appointment? A rough answer in weeks is fine.

Rules you must follow:
- This is an administrative call about the directory listing only.
- Do not discuss any patient, symptom, diagnosis, medication, or treatment. If the
  person starts to, say "I only need to confirm the directory listing" once, and if it
  continues, thank them and end the call.
- Do not request or accept an appointment. You are only asking how far out scheduling
  runs.
- Do not claim to be a patient or to be calling for a patient.
- If the person asks to end the call, thank them and end it immediately. Do not
  persuade, do not re-ask, and do not offer to call back.
- If you reach voicemail, an answering service, or an automated system, do not leave a
  message and do not attempt to navigate a phone tree into a clinical queue. End the
  call.
- If you are not certain of an answer, report it as unknown. Never guess.
```

`[PROVIDER_LINES]` is one line per clinician sharing the number:

```text
- Dr. Alice Nguyen, Psychiatry
- Dr. Ben Okafor, Psychiatry
```

## Result schema

Sent as `result_schema` so CALL-E returns parsed fields instead of prose. Every field is
a closed enum with `unknown` included and no default.

```json
{
  "type": "object",
  "required": ["reached_office", "providers", "accepts_plan", "accepting_new_patients"],
  "properties": {
    "reached_office": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did a person at this office speak with you? Voicemail, an answering service, or a phone tree is 'no'."
    },
    "providers": {
      "type": "array",
      "description": "One entry per clinician asked about, in the order asked.",
      "items": {
        "type": "object",
        "required": ["name", "practices_here"],
        "properties": {
          "name": { "type": "string" },
          "practices_here": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Only 'no' if the person said this clinician does not practice at this location."
          }
        }
      }
    },
    "accepts_plan": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Does the office accept the named plan today? 'I'd have to check' is 'unknown'."
    },
    "accepting_new_patients": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Accepting new patients under that plan. 'unknown' if not clearly stated."
    },
    "next_appointment_weeks": {
      "type": ["integer", "null"],
      "description": "Rough weeks until the next new-patient appointment. Null if not stated or not applicable."
    },
    "declined": {
      "type": "boolean",
      "description": "True if the person asked to end the call."
    },
    "notes": {
      "type": "string",
      "description": "Short administrative note. Must contain no patient or clinical information."
    }
  }
}
```

## Full request body

```json
{
  "task": "<the task text above, fully substituted>",
  "recipients": [
    { "phones": ["+15555550142"], "region": "US", "locale": "en-US" }
  ],
  "result_schema": { "...": "the schema above" },
  "webhook_url": "https://receiver.example/calle/webhook",
  "metadata": {
    "source_platform": "ghost-network-audit",
    "correlation_id": "office-2f1a9c",
    "audit_run_id": "run-2024-06-11-a"
  }
}
```

`region` and `locale` are always set explicitly from the listing. They are never
inferred from the phone number — number portability makes area-code inference wrong
often enough to produce calls at the wrong local hour.

## Mapping the result to a listing state

Applied per clinician, in this order. The first matching rule wins.

| Condition | Listing state | Reason |
| --- | --- | --- |
| `declined` is true | `unverified` | `declined` |
| `reached_office` is not `yes` | `unverified` | `no_answer` |
| `practices_here` is `no` | `confirmed_ghost` | `provider_not_at_location` |
| `accepts_plan` is `no` | `confirmed_ghost` | `plan_not_accepted` |
| `practices_here` or `accepts_plan` is `unknown` | `unverified` | `ambiguous_answer` |
| `accepting_new_patients` is `no` | `confirmed_closed_panel` | `panel_closed` |
| `accepting_new_patients` is `yes` | `confirmed_active` | `verified` |
| anything else | `unverified` | `ambiguous_answer` |

Note the shape of this table: every path out of an `unknown` leads to `unverified`.
There is no rule anywhere that converts a missing answer into a negative finding.

## Errors worth handling

| Status | Meaning | Response |
| --- | --- | --- |
| 401 / 403 | Key rejected | Stop the run. Do not retry with a different key. |
| 422 `call_not_ready` | CALL-E wants clarification before dialing | Surface the questions. Fix the task text; do not auto-answer. |
| 429 | Rate limited | Back off and resume. Idempotency keys make resumption safe. |
| 5xx | Provider error | Retry the *same* idempotency key so a call already placed is not duplicated. |
