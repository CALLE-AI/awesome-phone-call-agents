# A refusal is not a missed call, and the platform's retry is not ours

The Check-in Call says out loud that hanging up ends the calls for good. The call
platform, on the same event, offers to ring again in forty-five minutes. We suppress
that offer. `may_redial()` returns `False` for every outcome, and there is no code
path that places a second Check-in Call for one Appointment.

This came out of the first live call placed on this project. The recipient — the
person who wrote the Never-Ask Rule, who knew the call was coming because she had just
typed the command herself — heard a word or two and hung up because it felt like a
scam. The platform reported `DECLINED`, `hangup_type: ByCallee`, zero duration, no
transcript, and proposed a retry.

A hang-up is a withdrawal of consent expressed in the only way available to someone
who does not want to talk to a machine. Treating it as a connectivity failure inverts
its meaning: the more clearly a Patient refuses, the more times we would ring her.
Re-dialling would also break a promise the agent made aloud during the call, which is
worse than never having made it.

Two board statuses therefore stay distinct where a platform would collapse them:

| What happened | Status | What it tells the Practice |
| --- | --- | --- |
| Answered, then hung up | `declined` | She does not want these calls. Ring only if a clinician decides to. |
| Nobody picked up, or voicemail | `not_reached` | She has not been reached. One fixed message was left. |

A refusal is also not a Stop Condition. A Stop Condition is a surface condition that
ends a call early — a red-flag phrase, an answer that cannot be mapped to a bounded
field, repeated confusion. A Patient who hangs up produces no answers to map and no
condition to match, so the Review Item carries no Stop Condition. A Patient who
answers and cannot be understood does carry one. The two look different on the board
because they ask different things of the Reviewer.

## Consequences

Every provider added later must map its own terminal vocabulary into these statuses
rather than passing it through, and must not inherit its platform's repair or retry
defaults. `holdfor/outcomes.py` is the single place that mapping lives.

The suppression is only as good as the distinction: we cannot decline to redial an
outcome we have filed as "not reached". Any new terminal status from a provider that
is not recognised maps to `needs_review`, so an unknown outcome reaches a human
rather than being silently treated as a missed call.

## Amendment — the Rebooking Call inherits the suppression, and cannot dial twice

The same rule binds the second call, where the stake is different. A repeated Check-in
Call rings a Patient who has already refused; a repeated Rebooking Call books the same
Patient twice, and the second appointment is discovered by a receptionist rather than by
us.

`call_attempt.idempotency_key` is `rebooking:{release_id}` and `release.review_item_id`
becomes `UNIQUE`, so one Review Item holds one Release and one Release holds one call.
Pressing run again returns the existing attempt and dials nothing. The way out of
`submission_unknown` is `calle call recover`, which the platform provides for exactly
this, never a redial. The `UNIQUE` constraint also closes a race in `review.release()`,
which checked for an existing Release with a `SELECT` before its `INSERT` and could admit
two under concurrent posts.

The call is placed out of band for the same reason. `holdfor/checkin.py:138` places and
polls inside one request, which the fake provider satisfies instantly and CALL-E cannot:
`plan_call` alone carries a 150-second timeout, and a call that waits in a queue runs
longer. A Release therefore only reserves a `call_attempt` row and returns; a second
explicit step places the call and polls it to terminal. FastAPI puts `BackgroundTasks` at
lightweight work inside one process and points heavier work at a real queue — what a
restart would orphan here is a Patient's appointment, so the work sits in a step that can
be re-entered rather than in the tail of a response.

The cost is that a call which genuinely never rang cannot be retried by the board at all.
A human rings instead, and the board says so.

## Postscript — the guard read a column that was written too late

Both halves of the amendment above were decided and only half implemented. The check-in
path followed it; the Rebooking Call did not, and the gap was found by somebody trying to
film the demo rather than by the suite.

The second-press guard tested `provider_run_id`, which was written in the same statement
that recorded the finished conversation. So it was null for the whole length of the call,
and a press that landed while the agent was on the phone fell through the guard and
dialled the practice again. `reserve()` returning an existing row on a second press —
correct, and the thing that makes a second press harmless — is what removed the `UNIQUE`
constraint's protection here, and `count_against_the_budget` uses `INSERT OR IGNORE`, so
the budget stayed at one while the second call went out unrecorded.

The response was also held open for the length of the call, which the amendment says it
should not be. That is what made the defect reachable: the board sat there with the Run
button still on it and nothing to show that a call had gone, so pressing it again was the
only reasonable thing to do. The bug needed a person to trigger it and the interface
asked them to.

Two changes close it. The guard now tests whether an attempt exists at all, which is what
the amendment always said. The run id is bound the moment the provider accepts, before
anything waits on the call, so a process killed mid-call still leaves a row naming a real
run for `calle call recover` — the old order left a reserved row with no run id, which is
indistinguishable from a call that was never placed, and CALL-E offers no way to list
runs or cancel one.
