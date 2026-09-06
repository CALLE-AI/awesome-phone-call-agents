# What a surface can and cannot tell you about how a call ended

Everything below describes payload shapes and the reasoning that survives them. No call record, transcript, identifier or measurement from any real call appears here, and the fixtures the app ships are written for their files.

## The top-level failure_code is not where the reason lives

A failed call task can come back with a `failure_code` that only repeats the status. The errors guide is right that you should not branch on that field.

It is worth knowing the reason may still be in the payload, one level down, as a second `failure_code` on the attempt, in a different vocabulary from the first. Two fields with the same name and different alphabets on one object is a thing to be aware of before concluding the payload cannot tell you anything.

## Do not read failure_message as an ending

`failure_message` is prose, and prose that reads like an ending is not one. The same sentence can appear on calls that ended differently, so anything derived from it alone will be wrong on some of them.

If you need the distinction, the attempt-level code is the field that carries it, and whatever you read from it is inference. Mark it as inference and route it to a person rather than resolving a business outcome from it. `errors.mdx` is explicit that undocumented failure strings should not drive retry or analytics logic, and treating an inferred ending as a fact is how that rule gets broken by accident.

## task_completed is not a synonym for the job getting done

The spec defines it as a judgment about whether the task reached a clear end state for the user. Reaching a clear end state and getting the job done are different questions, and an answering machine reaches a very clear end state.

So a call task can report the task complete while the declared result sitting beside it says the question was never answered. The Calls guide is upfront that there is no `answered_by` field and recommends declaring one in a result schema. That recommendation reads like optional polish and it is not. Without it, a person and a voicemail box are the same event.

The pattern that catches this needs no voicemail detector. A completed task, on an ending where nothing establishes a person was on the line, goes to a human. That is two facts you already have, compared.

## completion_confidence is confidence in the verdict, not in the outcome

The spec describes it as confidence for `task_completed`, and `task_completed` is a judgment about the call reaching a clear end. So the number is about how sure the platform is of its own reading, which is a different question from whether anything useful happened.

The consequence is that a threshold on `score` does not separate a call that worked from a call that did not. Both can sit at the top of the range, and the label offers no more room than the score does. The OpenAPI gives `label` no enum, only "for example low, medium, high".

Nothing in this app branches on either field, and a test holds that line.

## A schema-shaped result does not mean a call happened

A structured result can arrive on a call that never reached a conversation. It matches the requested schema, required properties and all, with the fields that would have held speech left empty.

So the presence of a result proves the shape and nothing about whether anybody spoke. Code that checks whether a structured result arrived is satisfied by it. A result on a call that did not complete, or on a call whose transcript holds no turns from the other side, is better read as unsourced than as valid.

That second test is a count rather than a guess. A payload carrying no transcript at all says nothing either way and is left alone.

## Terminal does not always mean finished

A terminal status can arrive before the structured result is attached, so a client that reads once on the terminal status can see a null result on a call that produces one shortly after.

It moves the reading, not just the timing. The same call read at two moments can come back with two different result states, and a disposition that depends on how fast you looked is not a disposition. If you sent a result schema, keep reading for a bounded window after terminal.

Webhook deliveries do not have this problem. The event carries the finalized call task, so a receiver sees the result the platform settled on rather than a snapshot mid-flight.

## Webhooks carry no signature

Anybody who learns the URL can post something indistinguishable from the real thing. That is a fact about the channel rather than about the call, and no amount of reading the payload fixes it.

Keep it separate from what the payload says. A signed delivery carrying a voicemail and an unsigned one carrying the same voicemail describe the same call, and you should act on them differently.

## The short version

Three separate questions, kept apart:

- how the call ended
- whether the job got done
- whether usable data came back

And on each one, whether the source stated it, whether it was worked out, or whether the source cannot express that fact at all. The third of those is the one that matters. A mapping with no way to say "this surface does not carry that fact" will invent the fact.
