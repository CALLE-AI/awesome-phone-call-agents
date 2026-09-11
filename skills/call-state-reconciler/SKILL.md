---
name: call-state-reconciler
description: Work out what actually happened to a CALL-E call by reading the call task, its attempts and its event stream together, and say which field each conclusion came from. Use when a workflow acts on a call result, when a call will not settle, or when the platform's own signals disagree with each other.
license: MIT
---

# Call State Reconciler

A finished call hands you a status word, a `task_completed` boolean and a
confidence score. Three answers jammed into a shape that looks like one, and
the one everybody branches on is `task_completed`.

It comes back `true` for a voicemail box. The recording picks up, the agent
asks its question into the tone, and the call ends `completed` with a
schema-valid result and a high score. Nothing in that payload is a lie. There
is simply no field in it that says a person was ever on the line.

This skill covers reading a call properly: how it ended, whether the job got
done, and whether the answer came from anybody speaking. Three separate
questions, answered separately, each one carrying the field it was read from.

## When to use it

Use it before a call result moves anything in a system of record. Booking,
dispatching, charging, closing a ticket, marking a lead dead.

Use it when a call will not settle, or when you are looking at a batch of calls
and need to know which ones need a person today.

Use it when two signals disagree: the call task says one thing and its recipient
says another, or the attempt timing does not match the event stream.

Do not use it on a call nobody acts on automatically. A call that produces a
note for a human to read has no branch to get wrong, and this is overhead.

## The one field that changes everything

The Calls API carries no answered-by field. The calls guide says so directly and
tells you to define the classification yourself in a per-recipient result
schema:

```json
{
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
```

Send that and the ending stops being a guess. Without it the honest answer to
"did a person pick up" is that nothing in the payload establishes one, which is
true and not much use to anybody.

So the first thing this skill does with a call it cannot resolve is name the
field that would resolve it. A check that only ever says no gets switched off.

Note what `answered_by` is not. It is the platform's classification of what it
heard, so it can be wrong. What changes is who is doing the guessing: with the
field declared the claim is stated in the payload and can be pointed at, instead
of being inferred by whatever read it.

## The four things it reconciles

Each one is a state somebody has reported and nothing has closed.

**Nobody is watching it.** The call is still open, and long enough has passed
that whatever was waiting has already given up. A client timeout is not the same
as the call ending, and a call can dial well after the SDK has raised.

**It may have gone out twice.** The returned call is older than the request that
returned it, so the platform handed back one that already existed. A replay
otherwise reads exactly like a fresh creation.

**The clock contradicts itself.** An attempt that claims to have run longer than
the call existed, or one timestamped outside the window the events describe.
Only contradictions count. An event stream wider than the attempt window is
normal, because the stream also covers queuing and finalization.

**The retry is not safe.** The submission is in an unknown state, or the same
idempotency key was refused after a failure. Deriving the key from the
authorization rather than the attempt is what makes the next attempt answerable:
same approved action, same key, so a retry cannot become a second call.

## Read the event stream, not the attempt clock

`GET /v1/calls/{call_id}/events` carries a `created_at` on every event, declared
`format: date-time`, and those timestamps hold still.

The attempt timestamps do not. On a finished call they can be rewritten shortly
after it settles: the offset is dropped, the value moves, and sub-second
precision is lost to rounding. Read the same call twice and you can get two
different answers about how long it ran. A sub-second attempt rounds to zero.

So reconstruct timing from events and treat the attempt fields as evidence about
the attempt rather than as a clock. `references/observed-shapes.md` shows the
shape with invented values and how to check it on your own account.

## What it will not do

It reads fields. It does not interpret a transcript, score anything, or ask a
model what it thinks, so every sentence it produces traces to a value in the
payload and says the same thing every time.

It never resolves the business outcome. Where a reading rests on inference it is
marked as inference and routed to a person, and where no field carries the fact
at all it says that rather than filling the gap.

It places no calls.

## References

- `references/observed-shapes.md` - the platform behaviours this relies on, with
  invented values, and how to check each one yourself.
- `references/reading-a-call.md` - the three axes, the endings each surface can
  and cannot express, and worked examples.
