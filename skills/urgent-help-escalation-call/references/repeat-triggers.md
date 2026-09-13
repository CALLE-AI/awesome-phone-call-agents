# Repeat Triggers

Someone frightened, confused, or in pain presses a button more than once. That
is not a bug in their behaviour — it is what a person does when they are not
sure the first press worked.

The responder needs one call, not eleven. Each one costs real money, and a phone
ringing repeatedly reads as a malfunction rather than an emergency.

## The pattern

Hold a cooldown **per subject**, not per request:

```
on trigger:
  if withinCooldown(subject) -> log the suppression, do not call
  else                       -> markCalled(subject), place the call
```

Two properties that matter:

**Mark before you call, not after.** Two triggers a second apart will both pass a
check that only records success. Claim the window first.

**One subject's cooldown must never silence another's.** Key it on the subject
or the care circle, never globally. A shared counter means a busy household
suppresses a quiet one's genuine emergency.

## Choosing the window

Ten minutes is a reasonable default. The question to ask is: *if the same person
presses again this soon, does the responder learn anything new?* Usually not —
they are already being called, or already on their way.

Make it configurable. A care home with one responder per floor wants something
very different from a family of one.

## What suppression must not mean

**It is not silence — least of all towards the person who pressed.** Someone
frightened presses a button repeatedly precisely because they are not sure it
worked, and that is the moment they most need an answer. Suppressing the *call*
is right; suppressing the *response to them* is the opposite of what the button
is for.

Answer every press, and say something different the second time: not "alert
already raised", but "they already know, and they're on their way". The
suppression is an implementation detail they should never encounter.

**The in-app alert still fires on every press.** Only the *call* is suppressed,
because the call has already been made.

**It is not invisible.** Log every suppression with the subject and the time. A
run of suppressed triggers is a person pressing a button over and over, which is
itself worth a human knowing about.

**It does not survive forever.** If your cooldown lives in process memory, a
restart clears it and a redeploy mid-incident can allow one extra call. That is
usually an acceptable trade — an extra call is a smaller harm than a missed one
— but know which way your implementation fails, and prefer shared storage once
you run more than one instance.

## Idempotency as the second layer

The cooldown protects against a distressed human. An idempotency key protects
against your own retries:

```
idempotency_key = `${product}-help-${recipient_phone}-${floor(triggered_at / 60000)}`
```

Same recipient, same minute, same key — so a retried request after a timeout
cannot place a second call. The two layers guard different failures and you
want both.
