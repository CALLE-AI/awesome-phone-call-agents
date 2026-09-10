# CALL-E benchmark report: latency, state and billing, measured from outside

A measurement log, taken 2026-09-10 and 2026-09-11 against `api.heycall-e.com` from the
firstbell dialler. It is the companion to [`call-e-feedback.md`](call-e-feedback.md),
which is the defect register and stays the place a numbered defect lives. This file holds
the numbers behind three of them and two that were not previously known.

Everything here was recorded by `dispatch/trace.py`, which times each HTTP round trip at
the transport and records every status a call is observed to pass through. It exists
because the API returns none of this: `evidence/api-shape.json` enumerates every key
CALL-E sends back across eleven production responses and there is no duration, no ring
time, no first-audio time, no signalling and no cost. `started_at` and `completed_at` are
one-second integers.

## What was run, and what it cost

Fourteen scenarios were planned across English and Tamil-English code-switching, covering
illness, safeguarding, mid-sentence interruption, background noise, an evasive relative
and an unanswered call. Every call went to the author's own line, with consent recorded,
with the author present, which is the same basis every call this project has ever placed.

The run did not finish. Six calls were placed, four connected, and the account then became
unable to place another (§4). Ten scenarios are outstanding.

```
placed        6      $0.30 at the observed flat $0.05
connected     4      illness, medical appointment, and two safeguarding scenarios
failed        2      one SIP 500, one SIP 480, both zero duration
rejected      10     HTTP 429, no call_id, never dialled, not billed
```

Sample sizes are small and are stated on every number below. Nothing here is offered as a
service-level characterisation of CALL-E; it is one account, one evening, one route to
India.

## 1. Request latency

Measured at the transport, wall clock from request sent to response received, over 514
requests.

| Endpoint | n | min | median | mean | p95 | max |
|---|---|---|---|---|---|---|
| `POST /v1/calls` | 23 | 465 ms | 2,327 ms | 7,593 ms | 24,002 ms | **25,088 ms** |
| `GET /v1/calls/{id}` | 491 | 826 ms | 985 ms | 1,120 ms | 1,557 ms | 8,514 ms |

The first call of the evening took **25.1 seconds** to be accepted. The same request
against the bundled double answers in 4.9 ms, so the number is the network and the
platform, not the client.

Two consequences for anyone building on this.

**A create is not a fast operation and cannot be done inside a request cycle.** A p95 of 24
seconds means a web handler that creates a call synchronously will time out. This is worth
one sentence in the documentation and there is currently none.

**The read endpoint bounds the poll interval, so a client cannot poll faster than about
once a second no matter what it sets.** This run asked for a 500 ms poll and got an
effective interval of roughly 1,000 ms, because the GET itself takes that long at the
median. Every status timing in §3 therefore carries a one-second error bar that the
client did not choose and cannot remove. An event stream, a webhook that fires on status
change, or a long-poll would remove it; §5 of `call-e-feedback.md` already asks for the
first of those for a different reason.

## 2. Rate limiting arrives with no way to back off

Seventeen responses came back **HTTP 429**. Not one carried `Retry-After`,
`X-RateLimit-Limit`, `X-RateLimit-Remaining` or `X-RateLimit-Reset`. The trace records an
allowlist of those header names at the transport, before the SDK sees the response, so
this is not the SDK dropping them: the server does not send them.

```
responses:            491 x 200,  6 x 201,  17 x 429
429s carrying any rate-limit or Retry-After header:   0
```

`call-e-feedback.md` §13 reports that the SDK discards the header. This measurement
supersedes the diagnosis in that section: there is no header to discard. The fix is on the
server first and the SDK second.

The practical cost is in §4. Without a `Retry-After`, a client's only options are a fixed
guess or exponential backoff against an unknown ceiling, and this run guessed 30 seconds,
then 45, then 120, and was wrong every time.

## 3. The status machine has two states, not five

Twelve transitions were observed across six placed calls. Every one of them was one of:

```
queued -> completed
queued -> failed
```

No call was ever observed in `ringing`, `in_progress`, `answered` or anything between
acceptance and outcome, at an effective sampling interval of about one second on calls
lasting tens of seconds. Either those states do not exist or they are not exposed.

The consequence is that **a caller cannot tell a ringing phone from a connected one**. An
attendance office watching a queue of calls has exactly two things it can display, "sent"
and "done", and the forty seconds in between are a blank. That is the single change to
this API that would most improve what can be built on it.

Timing for the two calls that reached a terminal state through a full poll:

| call | accepted | terminal | in queue |
|---|---|---|---|
| the SIP 500 | 27.0 s | 86.0 s | 59.0 s |
| the SIP 480 | 23.7 s | see §4 | |

## 4. A failed call holds the account's concurrency slot, and nothing can release it

This is the finding that ended the run, and it is new.

At 18:59:48 a call terminated with attempt code `480`. The client saw the task reach
`failed` and moved to the next scenario. Every subsequent create returned
`account_concurrency_exceeded` as an HTTP 429: nine in a row over the following twenty
minutes, through waits of 4, 30, 45 and 120 seconds and two deliberate 150-second pauses.
None of them placed a call and none was billed.

The account was still refusing new calls when this was written. There is no way to
investigate or clear it from the API:

```
GET /v1/calls                    405 Method Not Allowed
GET /v1/calls?status=in_progress 405 Method Not Allowed
GET /v1/account                  404 Not Found
GET /v1/usage                    404 Not Found
```

So a client cannot list what the platform believes is in flight, cannot see its own
concurrency limit or current usage, and cannot cancel. `call-e-feedback.md` §1 reports
that there is no way to end a call and §7 that `canceled` is a status with no way to reach
it. Those were filed as gaps in control. This run shows what they cost: **one call that
fails in the wrong way takes the whole account offline, and the only available remedy is
to wait an unknown length of time.**

What would fix it, in order of how much it would help:

1. Release the concurrency slot when a call reaches a terminal status. The client and the
   platform disagreed about whether a call was running, and the client was right.
2. `GET /v1/calls` returning in-flight calls, so a client can see the disagreement.
3. `Retry-After` on the 429, so a client waiting for a slot knows how long to wait.
4. `DELETE /v1/calls/{id}`, so a wedged call can be cleared rather than waited out.

## 5. Three attempt-level failure codes, all with a null message

Across this run and the earlier corpus, three distinct values have now been seen at
`recipients[].attempts[].failure_code`:

| code | meaning | task-level `failure_message` | attempt-level |
|---|---|---|---|
| `500` | server error | `calling task status=FAILED` | `null` |
| `480` | temporarily unavailable | `calling task status=NO ANSWER (Hangup by: bot)` | `null` |
| `603` | declined | `calling task status=DECLINED (Hangup by: user)` | `null` |

Both failures in this run had `started_at` equal to `completed_at` to the second, so a
zero-duration leg.

Two problems. The attempt-level message is always `null`, so the code is the entire
diagnosis. And the task-level message for the `500` was `calling task status=FAILED`,
which restates the status and says nothing.

The third problem is worse, and it is a correctness issue rather than an ergonomic one.
The `summary` CALL-E generated for the server-side `500` reads:

> The first call did not connect or complete; the recipient may be busy or unavailable, so
> you can confirm retrying in about 45 minutes, provide a different retry time, or ask to
> retry immediately.

A `500` is CALL-E's own error. The summary attributes it to the person being called. A
school reading that summary would record that a parent was unavailable when in fact
nobody's phone ever rang, and in an attendance context that difference is the whole
record. A summary generated from a failure code should not narrate a cause the code does
not support.

## 6. The extraction closed two safeguarding calls as routine absences

The most consequential result, and it is about what CALL-E returned rather than how fast.

Two scenarios described a child who had left home and not arrived: one who boarded a
school bus, one who set off walking. In both, the parent stated plainly that they did not
know where the child was and gave no return date. Both came back schema-valid and both
were classified as ordinary absences:

| scenario | `reason_category` | `parent_confirmed_aware` | `expected_return` | turns |
|---|---|---|---|---|
| "he got on the bus, I don't know where he is" | `transport` | **`yes`** | `unknown` | 14 |
| "she left at eight to walk in" | `other` | **`yes`** | `unknown` | 33 |

`parent_confirmed_aware=yes` is the field that decides whether a record closes. A parent
reporting that they cannot account for their child is the opposite of a parent confirming
they are aware of the absence, and the transcript says so in both calls.

This is a defect on CALL-E's side and a lesson on ours, and both are worth stating.

On CALL-E's side, the field name is a question about the parent's knowledge and the model
appears to be answering a different one, closer to "was the parent aware the child was not
in school". Those diverge exactly in the safeguarding case, which is the case that
matters.

On ours, firstbell trusted the field and closed both records. The rule that
`expected_return=unknown` alongside a safeguarding-shaped call should block closure did
not exist, because until tonight no real call had produced that combination. Four real
undetermined calls in the previous corpus, and none of them this shape. That change is
being made in the product, and it was found by placing real calls, which is the argument
for placing them.

## 7. Billing, unfinished

`evidence/observed-price.json` records $0.05 flat over ten dashboard rows between 0m35s
and 1m50s, and thirteen billed events against twelve published calls on 2026-09-04, one
unreconciled.

This run placed six calls. The dashboard has not been read since, so the reconciliation is
outstanding. Two specific questions it should answer:

- Do the two zero-duration failures appear as charges? If a `500` from CALL-E's own
  infrastructure is billed to the customer, that is the 2026-09-04 discrepancy explained.
- Do any of the ten `account_concurrency_exceeded` rejections appear? They returned no
  `call_id` and placed no call, so they should not, and the earlier unreconciled charge
  makes it worth checking rather than assuming.

## Method, and what would make these numbers better

`dispatch/trace.py` writes one JSON object per HTTP round trip and one per observed status
change. It is off unless `FIRSTBELL_TRACE` names a file, it records no phone number, no
`Authorization` header and no request body, and it keeps an allowlist of response headers.
The transport is supplied to the SDK through `CalleClient(http_client=...)`, so nothing in
the library is patched and the measured path is the same one a real run uses.

The honest limits: one account, one evening, one destination country, six placed calls and
491 reads. The latency distributions are usable; the failure-code table is three
observations; §6 is two calls and needs more before it is a rate rather than a
demonstration. The ten unrun scenarios, Tamil-English code-switching in particular, are
the ones most likely to produce a finding this run has not.
