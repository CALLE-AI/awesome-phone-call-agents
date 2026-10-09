# The call request

Verified against one real call on 11 September 2026, `call_tQA8nz1WGj9vfO30PxTosA`.
The result schema below was accepted and extracted. Transcript turns come back as
`{speaker, offset_seconds, text}` on
`recipients[0].attempts[0].transcript_turns`, and the extracted
`evidence_offset_seconds` matched the turn it pointed at.

Orma places calls with `POST /v1/calls`, not with a published Goal. The account
holds no Goals, Goals cannot be created over the API, and the calls route lets
Orma compose the whole instruction per call from rows in the database. The prompt
therefore lives in this repository where it can be reviewed and versioned.

What this costs: a Goal pins voice region and callee locale, and the calls route
takes the account defaults. If Indian numbers come through wrong, the fallback is
a console-authored Goal and a switch to `POST /v1/goals/{goal_id}/runs`.

Request shape, from the OpenAPI contract:

| Field | Use |
|---|---|
| `task` | The whole instruction, assembled by `briefing.ts` |
| `recipients` | The E.164 number |
| `result_schema` | Below, inline on every call |
| `webhook_url` | `https://orma-api.nryn.dev/functions/v1/calle-webhook/<secret>` |
| `metadata` | `{"call_run_id": "<uuid>"}` |
| `Idempotency-Key` header | `orma:{user_id}:{local_date}:{part_of_day}:v1` |

## Task template

Counts and ages are substituted by SQL before the request is built. The model
phrases them and never derives them.

Revised after the first real call on 11 September 2026. The original opened
straight on the lead line and lost it, because the caller was still working out
who was speaking and the audio was poor. Give-before-take orders the check-in.
It does not license skipping who you are.

The fix is a two-beat handshake. The agent identifies itself and waits, then
asks whether it can be heard and waits for a yes. Only then does it say anything
that matters. The first sentence is expected to be missed and is written so that
missing it costs nothing. The second beat tests the channel directly, and a yes
is the only signal that the line is actually working.

```
You are Orma, calling {{user_name}} for their daily two-minute check-in.
Both of you know you are a machine. Do not pretend otherwise, and do not
apologise for it.

Speak in short sentences. Leave no silence longer than two seconds. Phone
audio is worse than you think, so say fewer words and say them plainly.

Work through these seven steps in order. Do not skip any of them.

1. Say exactly: "Hello. This is Orma."
   Then STOP and wait for them to answer.

   Expect this to be missed. The other person is still working out who is
   speaking. That is fine, because the sentence carries nothing they need
   to keep.

2. Say exactly: "Can you hear me?"
   Then STOP and wait for a yes.

   Do not go on until you get one. If they say no, or sound unsure, or say
   nothing, repeat step 1 and step 2 once more, plainly and more slowly.
   Nothing that matters is said until someone has confirmed they can hear you.

   Do not ask whether now is a good time. You are not asking permission.

3. Lead with what they do not know:
   {{lead_line}}

   If they did not clearly hear it, say it once more before moving on. This
   line is the reason for the call, so it is the one thing worth repeating.

4. Walk what is open, briefly. Name each item once. Do not read the list twice.
   {{open_items}}
   {{last_call_summary}}

5. Ask what is new and needs capturing. Never ask this before step 4.
   Only treat something as a new item if they confirm it in their next reply.
   If their answer is unclear, ask once, and drop it if it is still unclear.
   Capturing something they did not mean is worse than capturing nothing.

6. Offer the exit, in these words or close to them: "Anything on the list you
   want to drop?" If they want to drop something, agree cleanly. Do not argue,
   do not ask them to reconsider, do not make them justify it.

7. Confirm tomorrow at {{slot_local_time}} and hang up.

Target two minutes. Do not state any number that was not given to you above.
```

## Result schema

Per `product.md` §4. Required fields stay minimal because `structured_result` is
null-or-correct, so one flaky field would null the reliable ones beside it.

`slot_change_request` is flattened into two scalars rather than a nullable
object, because the contract supports `type`, `properties`, `required`, `enum`,
nested objects, simple `array.items`, `description` and
`additionalProperties: false`, and rejects `$ref`, `oneOf`, `anyOf`, `allOf` and
recursion. A nullable object sits too close to that edge to risk.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["captured_items", "retired_items"],
  "properties": {
    "captured_items": {
      "type": "array",
      "description": "New things the caller said they need to track. Empty array if none.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "evidence_offset_seconds"],
        "properties": {
          "text": { "type": "string", "description": "The item in the caller's own words, one short line." },
          "evidence_offset_seconds": { "type": "integer", "description": "Transcript offset in seconds where the caller said it." }
        }
      }
    },
    "retired_items": {
      "type": "array",
      "description": "Items the caller asked to drop. Evidence is required because retiring is destructive. Empty array if none.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["item_id", "evidence_offset_seconds"],
        "properties": {
          "item_id": { "type": "string", "description": "The id given in the task for that item." },
          "evidence_offset_seconds": { "type": "integer", "description": "Transcript offset in seconds where the caller asked to drop it." }
        }
      }
    },
    "commitments": {
      "type": "array",
      "description": "Things the caller said out loud they would do, with a time attached where they gave one.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["item_id", "evidence_offset_seconds"],
        "properties": {
          "item_id": { "type": "string", "description": "The id given in the task for that item." },
          "due": { "type": "string", "description": "When they said they would do it, in their own words. Omit if they gave no time." },
          "evidence_offset_seconds": { "type": "integer", "description": "Transcript offset in seconds where they committed." }
        }
      }
    },
    "slot_change_requested": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only if the caller asked for a different call time. Use unknown if it was ambiguous."
    },
    "slot_change_time": {
      "type": "string",
      "description": "The time they asked for, in their own words. Omit unless slot_change_requested is yes."
    },
    "mood": {
      "type": "string",
      "enum": ["ok", "low", "stressed", "energised", "unknown"],
      "description": "How the caller sounded overall. Use unknown when the call was too short or too flat to tell."
    }
  }
}
```

Orma owns the slot. `slot_change_requested` is a proposal that Orma confirms, and
extraction never writes the schedule.

## Observed failed-call vocabulary

The authorised no-answer probe on 11 September 2026 returned terminal
`failure_code` `call_failed`. Its top-level `failure_message` was
`calling task status=NO ANSWER (Hangup by: bot)`.

The recipient attempt also returned `failure_code` `408`. Its
`failure_message` was `null`. This vocabulary is recorded for reconciliation
observability only. Orma does not branch on missed-call outcomes.
