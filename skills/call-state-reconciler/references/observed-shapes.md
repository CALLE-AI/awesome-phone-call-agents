# What the platform does, and how to check it yourself

Every value in this file is made up. Times, scores, codes in context, all of it.
The shapes are the point, and each section says how to see the shape on your
own account. Nothing here was copied out of a real call.

## Attempt timestamps change after the call finishes

Read a finished call straight away, then read it again a minute later. The
attempt's `started_at` and `completed_at` can come back different the second
time.

Invented values, real shape:

```
first read   started 2000-01-01T14:07:30.412000Z   completed 14:08:21.905000Z   offset, sub-second
later read   started 2000-01-01T10:07:30           completed 10:08:22           no offset, whole seconds
```

The offset goes. The value shifts by what the offset was. The fraction of a
second goes. After that it stays put.

So a duration worked out from those two fields depends on when you looked, and
a very short attempt rounds down to nothing.

The event stream is the steadier clock. `GET /v1/calls/{call_id}/events` gives
every event a `created_at` with an offset, and those stayed the same across
reads.

To check it: place one call to a line with no person on it, read
`GET /v1/calls/{id}` the moment the status goes terminal, then again a minute or
two later. Diff `recipients[].attempts[]`. The same behaviour is tracked
upstream in #374 and #377.

## The call and its own recipient can disagree

Invented shape:

```
status                 queued
recipients[0].status   in_progress
attempts[0]            started_at equal to completed_at, failure_code null
```

Seen once. It's why anything that isn't a published terminal status counts as
still open here.

## The attempt carries its own failure_code

The top-level `failure_code` repeats the status. The attempt has a second
`failure_code` in a different vocabulary. The values look like SIP response
codes. Nothing published says they are.

Only codes that have turned up alongside a known ending get decoded, and always
as inference:

```
408   rang out, nobody picked up
486   busy
404   number assigned to nobody
403   refused before it rang
```

Anything else reads `unknown`. Two destinations that couldn't be reached have
come back with two different codes, so this is not a clean map onto an ending,
and nothing built on it should claim to be quoting the payload.

## failure_message doesn't tell endings apart

A call that rang out and a call refused on the spot can come back with the same
`failure_message`. So it's never read as an ending.

## A result can arrive on a call nobody answered

Invented shape:

```
status              failed
structured_result   { "answer": "unknown", "evidence": "" }
```

Right schema, required fields there, evidence empty. A check for "did a result
come back" says yes.

Counting turns where the other side spoke helps. A recorded greeting counts as
a turn too, though. A turn tells you there was sound, not that somebody was
listening.

## completion_confidence is not a success signal

Invented numbers that keep the shape:

```
0.94  high     the job really was done
0.93  high     voicemail box, nothing answered, task_completed true
0.61  medium   never reached the network
```

The real success and the false one sit right next to each other. There's no
threshold between them to put a gate on, so nothing here branches on the score.

## Seen once, not relied on

Reading a live call once appeared to show every event carrying the call's
current status instead of the status when it fired. A completion event once
turned up before the only attempt started. Neither was reproduced and nothing
here depends on them.
