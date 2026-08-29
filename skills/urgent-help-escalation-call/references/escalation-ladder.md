# Escalation Ladder

What to do when the call does not land. An escalation that stops at the first
unanswered phone has done nothing except create the feeling that somebody was
told.

## The rungs

1. **Primary recipient.** One call. If `reached: caregiver` and
   `acknowledged: yes`, stop — somebody is going.
2. **Voicemail or no answer → the backup contact**, if one is configured. Same
   message, same rules. Do not wait long between rungs; the reason you are on
   this ladder is that the first rung failed.
3. **Nobody reachable → say so loudly in the product.** The in-app alert should
   change state to something like "we could not reach anyone by phone", not sit
   there looking identical to a delivered escalation. This is the state most
   likely to be silently wrong, and the one a family most needs to know about.
4. **Stop.** Do not loop the ladder indefinitely. Each pass costs money and none
   of them are reaching anybody.

## Never

**Never call the subject back.** They are already frightened, already waiting.
A ringing phone from the system that was supposed to fetch help is not reassurance.

**Never re-ring a recipient who acknowledged.** They said they are going. Calling
again while they are driving there is actively unhelpful.

**Never suppress an escalation because a similar one happened yesterday.**
Repetition across days is information — surface the pattern, but escalate each
one. Suppression belongs inside the [cooldown window](repeat-triggers.md), not
across incidents.

**Never send the raw provider payload, credentials, or the full phone number**
into whatever channel carries the escalation onward.

## Timing, honestly

Placing a call is not instantaneous. **Measured on CALL-E: about two minutes**
from the API call to the phone actually ringing — button pressed at 04:04, phone
rang at 04:06.

Write your product copy accordingly. "You will be called" is true. "You will be
called instantly" is not, and the gap between them is where trust is lost.

If the trigger is genuinely time-critical — a fall, a cardiac event — this skill
is an addition to an emergency route, never a substitute for one. Two minutes is
a long time when someone is on the floor.

## The call arrives from a number they do not know

The single most practical problem, and it is easy to miss until a real call
lands: the escalation arrives from an unfamiliar number, at exactly the hour
people decline unfamiliar numbers. Modern phones silence unknown callers by
default, and Do Not Disturb rules commonly allow contacts only.

Whatever your provider gives you, do two things:

- **Show the number in the product** once you know it, and tell the recipient
  plainly to save it as a contact. This is setup work, not an afterthought — an
  escalation declined as spam has failed at the only job it had.
- **Never rely on the call alone.** The in-app alert is what the recipient will
  see if the call is silenced, so it must carry the same information and must
  not be downgraded to a summary of "we called you".

## Recording it

For every rung, keep: who was called (masked), when, what came back, and what
you did next. When a family asks "did anyone actually try to reach me", that
record is the answer, and reconstructing it afterwards from provider logs is
both slow and incomplete.
