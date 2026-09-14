# Ambiguous Outcomes

A call whose outcome is unknown is the most expensive failure mode in this skill. It is not an error to retry.

## What `unknown` Means

The host timed out, the CLI returned no terminal status, or the provider accepted a request and never reported whether a person was reached.

A spare parts shop who already quoted a radiator will quote it again if you redial. Two conversations now exist for one `requestId`. Someone may have pulled the part off the shelf.

## Rules

- Classify it as `outcome: unknown` and stop.
- Do not call `calle call start` again for that `requestId`.
- Keep the same `requestId`. If the user later resumes, poll the existing `run_id` with `calle call status`. Do not start a new run.
- Tell a person to confirm with the spare parts shop whether they were called.

## Contrast With Terminal Misses

| Outcome | Meaning | Next step |
| --- | --- | --- |
| `no_answer` | Provider confirmed nobody picked up | Human may authorize a **new** `requestId` later |
| `voicemail` | Provider confirmed voicemail | Do not treat as stock info. Human decides |
| `declined` | They asked you to stop | Do not call again |
| `unknown` | You do not know if a call happened | Poll the same run. Never start a second |

`no_answer` is a fact. `unknown` is missing evidence.

## Client Timeouts

If the agent stops waiting, persist `run_id` and `requestId`. Resume with status only. Starting again because "the tool timed out" is how duplicate calls happen.
