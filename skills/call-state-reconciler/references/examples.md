# Examples

## Ask who picked up, so the ending stops being a guess

Send a per-recipient schema alongside whatever result you already ask for. This
is the single highest-value change, and it costs one field.

```json
{
  "task": "Confirm the appointment on Thursday at two.",
  "recipients": [{ "phones": ["+15550100"], "region": "US", "locale": "en-US" }],
  "result_schema": {
    "type": "object",
    "required": ["answer", "evidence"],
    "properties": {
      "answer": { "type": "string" },
      "evidence": { "type": "string" }
    }
  },
  "recipient_result_schema": {
    "type": "object",
    "required": ["answered_by"],
    "properties": {
      "answered_by": {
        "type": "string",
        "enum": ["human", "ivr", "voicemail", "unknown"],
        "description": "Classify the final endpoint. If an IVR transfers the call to a person, use human."
      }
    },
    "additionalProperties": false
  }
}
```

Read it back at `recipients[0].structured_result.answered_by`.

## The pairing to check before anything acts

```
task_completed        true
answered_by           voicemail
```

Both fields are correct and the combination is the one that costs money. A
voicemail box reaches a clear end state, which is what `task_completed` is
defined against, so it is true and the job is not done.

The check is one line: if the job is reported done and the ending is not a
conversation, it needs a person. Do not write it as `answered_by != "human"`,
because an absent field is falsy and absent is the common case. Check that the
ending is positively one of the endings that mean a person, and treat everything
else, including missing, as not established.

## Do not compute duration from the attempt

```
read at t+0s     started_at 14:07:30.412000Z   completed_at 14:08:21.905000Z
read at t+60s    started_at 10:07:30           completed_at 10:08:22
```

Invented values, real shape. Same call, same field, two reads. The offset is gone, the value has moved, and
the precision is down to whole seconds. A call whose attempt lasted a fraction
of a second reads as zero once that rounding happens.

Take timing from `GET /v1/calls/{call_id}/events` instead. Those `created_at`
values held still across every read.

## A result is not evidence that anybody spoke

```
status                failed
structured_result     { "open_saturday": "unknown", "evidence": "" }
```

Schema-valid, both required properties present, on a call that never connected.
Checking whether a structured result arrived returns yes here.

Count turns whose speaker is the other party before treating a result as
sourced, and remember that a recorded greeting produces such a turn too. Zero
turns from the other side is a strong signal. One turn is not proof of a person.

## A call that has not ended is not a call that failed

```
status                queued
recipients[0].status  in_progress
attempts              one, started and completed at the same timestamp
```

Seen once, shape only. The call task and its own recipient disagree
about whether it has started, and the attempt claims to have begun and finished
in no time at all.

Treat any status that is not one of the published terminal values as still open,
including a status you do not recognise, because not recognising a status is not
the same as the call being over. Only one of those two mistakes rings a phone.

## Which key to send on the next attempt

Derive the idempotency key from what was authorized, never from the attempt.

```
key = hash(channel, workflow id, purpose, destination, contract version)
```

Same approved action, same key, forever. A fresh key per retry tells the
platform every retry is a new call, which is how somebody gets rung twice after
a timeout that only ever meant the client stopped watching.
