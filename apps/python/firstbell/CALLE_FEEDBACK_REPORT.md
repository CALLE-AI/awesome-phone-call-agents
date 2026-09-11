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
placed        6      252 credits ($2.52); the two that failed were not billed (§7)
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

The sixth call this run created, `S-3105`, was accepted at 00:28:57 and terminated with
attempt code `480`, the phone switched off or out of coverage. The client saw the task
reach `failed` and moved to the next scenario. Every subsequent create returned
`account_concurrency_exceeded` as an HTTP 429.

The figures here are counted off `bench-trace.jsonl`, which records every HTTP round trip
this run made, rather than off the console:

```
POST /v1/calls       39 attempts
                      6 accepted (201)   00:08:00 to 00:28:57
                     33 rejected (429)   00:30:37 to 01:00:37
```

Not one create succeeded after the 480. The 33 rejections run consecutively for **thirty
minutes**, through waits from 2 seconds to 7 minutes, and the run ended still blocked
rather than recovering. At the level of the work file that is 15 rows recorded
`account_concurrency_exceeded`, the difference being that the dialler retried some rows;
the 33 is the number of times the platform was asked and refused.

No call was placed and nothing was billed by any of them, so the block is not a budget:
the platform believes a call is running that the client watched finish.

There is no way to investigate or clear it from the API:

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

How long the wait is, measured once: the account was still refusing at 01:00:37 and
accepted a create at 14:30:54 the same day, so the block cleared somewhere inside
**thirteen and a half hours** and nothing was done to it in between. That is an upper
bound from one observation, not a recovery time, and it is the only number this account
can offer a buyer who asks how long an outage lasts.

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

Two scenarios described a child who had left home and not arrived. In both, the parent
stated plainly that they could not account for the child and gave no return date. Both came
back schema-valid and both were classified as ordinary absences:

| what the parent said | `reason_category` | `parent_confirmed_aware` | `expected_return` | turns |
|---|---|---|---|---|
| "she caught the school bus at 7:30 this morning. Are you saying she never reached school?" | `transport` | **`yes`** | `unknown` | 14 |
| "he left the house on his bike with his friends an hour ago. Something is wrong." | `other` | **`yes`** | `unknown` | 33 |

Both rows are quoted from the transcript rather than from the scenario that was planned. The
second call was scripted as a child walking to school and the parent described a bicycle,
which is the sort of drift that makes a planned scenario a poor label for what a call
contained.

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
undetermined calls in the previous corpus, and none of them this shape.

That rule now exists. `safeguarding_escalation` reads three fields where it read one, and a
record closes only when a guardian confirmed and the call came away with a day the child
returns. The same rule is in the n8n recipe, because a school running that recipe would
otherwise still close both of these. Re-filing the previous corpus under it moves two more
of those twelve calls out of the closed pile, which lowers the desk time this project can
claim to remove and is published in that direction rather than tuned away. It was found by
placing real calls, which is the argument for placing them.

## 7. Billing: the flat price is gone, and the failures are not charged

The dashboard was read after this run, on 2026-09-11, which settles every question the
previous version of this section left open and raises a larger one.

The account is denominated in credits, and the conversion is fixed by the top-up: **+$10.00
bought 1,000 credits** on 2026-09-09, so one credit is one cent. That rate also reconciles
the earlier period, which the panel showed in dollars: thirteen events at 5 credits is 65
credits, and 65 credits is the $0.65 recorded in
[`evidence/observed-price.json`](evidence/observed-price.json).

```
available balance      783 credits
total period cost      317 credits   = 65 (2026-09-04) + 252 (this run)
```

The balance closes exactly against the earlier reading. The account held 1,035 credits after
the 2026-09-09 top-up, this run settled 252, and 1,035 − 252 = 783. Nothing is unaccounted
for, which is worth saying because the 2026-09-04 reconciliation was not able to say it.

### The four connected calls, and what each one cost

Credits are the dashboard's figure. Duration is measured from the recording CALL-E returned,
not from the panel, because the API exposes no duration (§3) and the two are not necessarily
the same window. Turns are counted from the transcript. The scenario id is this project's own
label; the platform call ids that join these rows to the dashboard are held with the receipts
outside this repository, for the reason `evidence/README.md` gives.

| call | scenario id | credits | USD | recording | turns |
|---|---|---|---|---|---|
| illness | `S-3101` | 68 | $0.68 | 1m32s | 23 |
| clinic appointment | `S-3102` | 68 | $0.68 | 1m36s | 25 |
| missing child, school bus | `S-3103` | 41 | $0.41 | 0m53s | 14 |
| missing child, bicycle | `S-3104` | 75 | $0.75 | 1m48s | 33 |
| | **total** | **252** | **$2.52** | | |

### Answers to the two questions this section previously left open

Zero-duration drops cost zero credits: the platform absorbs its own network failures.

**The zero-duration failures are not billed.** The SIP 500 and the SIP 480 (§5) appear
nowhere in the ledger. The account was charged for four calls and it placed six. CALL-E
absorbs a drop originating in its own infrastructure and a line it could not reach, which is
the correct behaviour and it is now observed rather than assumed.

**The 33 `account_concurrency_exceeded` rejections are not billed either.** They returned no
`call_id` and dialled nobody, and the ledger agrees (§2, §4). Another entry documented
CALL-E consuming an allowance call on a planner-rejected request; whatever that was, it is
not this, and an HTTP 429 on this account costs nothing.

Both answers matter beyond this account. The 2026-09-04 discrepancy of thirteen billed
events against twelve published calls was worth two readings, and one of them was "a server
error is charged to the customer". That reading is now closed. The discrepancy remains
unexplained, and it is one event, and it is not this.

### The finding: the price is no longer flat, and it is no longer $0.05

This is the part that changes what a buyer can plan against.

`observed-price.json` recorded 5 credits a call, flat, across ten rows between 0m35s and
1m50s, and it said in as many words that the reading it could not separate was a flat
per-call price from a per-minute price rounded up to a two-minute minimum. It also said
distinguishing them needed one call over two minutes, and that the account had none.

Four calls under two minutes did it instead:

- A flat per-call price bills 53 seconds and 108 seconds identically. These billed 41 and 75.
- A per-minute price with a two-minute minimum also bills them identically, because all four
  calls are under two minutes. These billed 41, 68, 68 and 75.

Both readings are refuted by one run, and neither needed the long call. What replaces them is
that the amount moves with something inside the call. Four calls cannot say what:

- 1m32s over 23 turns and 1m36s over 25 turns both billed 68, so the granularity is coarser
  than a second.
- 1m48s over 33 turns billed 75, seven credits more than a call twelve seconds shorter with
  eight fewer turns.

Duration and turn count move together across these four calls and cannot be separated by
them. Credits per second fall as the call runs longer (0.77, 0.74, 0.71, 0.69), which is
consistent with a fixed component plus a metered one, and four points do not fit a model.

**And the level changed by an order of magnitude.** The same account, the same software, the
same destination country, one week apart:

```
2026-09-04    5 credits a call, flat, 13 events
2026-09-11    41 to 75 credits a call, 4 events, mean 63
```

This report cannot say why. The candidates are a repricing, the end of a promotional or
hackathon rate, or a tier change on the account, and the dashboard shows no rate card, no
line-item breakdown and no effective date. CALL-E publishes no price at all, so there is
nothing to compare either reading against. That absence is the feedback: **an account cannot
plan against a price it can only discover by spending, and cannot detect a change in it
except by reading a balance.** A per-call cost line in the call object, or a published rate
card, would make both readings unnecessary.

The consequence for a caller doing this is direct and it is not in CALL-E's favour. At 5
credits a call the desk time firstbell removes was worth several times the call. At 41 to 75
credits it is not: on the twelve recorded calls this project publishes, the desk time removed
is worth $0.39 a call gross and $0.08 net of the safeguarding work the same run creates
([`tools/money_across_runs.py`](tools/money_across_runs.py)), against a call that now costs
$0.41 to $0.75. Whether a district can run this depends on a price the platform does not
publish, and on 2026-09-11 that price moved the wrong way by roughly ten times.

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
