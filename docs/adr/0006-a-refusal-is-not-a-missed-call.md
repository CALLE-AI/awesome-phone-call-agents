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
