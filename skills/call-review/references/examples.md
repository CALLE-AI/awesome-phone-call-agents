# Examples

The five fixtures in `apps/web/call-review-console/fixtures/` are fictional calls that each exercise one rule.

## Approve (`call_fx_001`)

Task: confirm a 9 a.m. appointment and ask about a text reminder. The callee says "Yes, nine works" and "Text is fine"; the result reports `confirmed: true`, `wants_text_reminder: "yes"`, `appointment_time: "9am"`. The number is spoken, the enum fields are read in context, the agent disclosed it was an AI in its first turn, p95 latency 2.1 s.

Verdict: `approve`. Reason line: "2 field(s) could not be checked deterministically" (the two enums; the model pass or the reviewer reads them).

## Reject: unsupported claim (`call_fx_002`)

The result says `rescheduled_to: "Thursday 2pm"`. No turn mentions Thursday or 2 pm; the callee only said they would "call back". p95 latency 7.8 s.

Verdict: `reject`. Reasons: "1 structured field(s) not supported by the transcript: rescheduled_to", "slow responses: p95 7.8s".

## Reject: stop request ignored, no disclosure (`call_fx_003`)

The callee says "please don't call this number again" at 18 s; the agent asks another question at 21 s. No agent turn discloses an AI.

Verdict: `reject`. Reasons: "callee asked to stop and the agent kept going", "no AI disclosure found in the agent's turns".

## Reject: failed call (`call_fx_004`)

`status: failed`, `failure_code: no_answer`. Nothing else is evaluated.

## Needs a human: overlaps (`call_fx_005`)

Every field is supported, but two agent turns start before the callee finished (negative latency). The result is probably right and the script talks over people.

Verdict: `needs_human` (or `approve` when overlaps are below the threshold). Reason: "2 overlapping turns".
