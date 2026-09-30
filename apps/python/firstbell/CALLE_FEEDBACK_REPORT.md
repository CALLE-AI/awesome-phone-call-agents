# CALL-E benchmark report: latency, state and billing, measured from outside

A measurement log, taken 2026-09-10 and 2026-09-11 against `api.heycall-e.com` from the
firstbell dialler. It is the companion to [`call-e-feedback.md`](call-e-feedback.md),
which is the defect register and stays the place a numbered defect lives. This file holds
the numbers behind three of them, and the findings in §4, §6, §7, §8 and §9, which that
register does not carry.

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

The first session did not finish. Six calls were placed, four connected, and the account
then became unable to place another (§4). A second session the same afternoon placed
thirteen more on the same account and the same route; eight connected, five failed, and not
one create was refused, so the block of the night before did not recur. Between them, and
with the eight calls of the 2026-09-04 locale experiment, twenty live calls are now
published: fourteen `en-IN`, six `ta-IN`, 1,435 seconds of recording and 370 transcript
turns, counted off the transcript file the receipts carry. The second session reached the
Tamil-English code-switching pair the first never got to, and that pair produced the
strongest finding in this document (§7). Interruption, background noise and an evasive
relative appear in neither session.

```
first session, creates 00:08:00 to 00:28:57

placed        6      252 credits ($2.52); the two that failed were not billed (§10)
connected     4      illness, medical appointment, and two safeguarding scenarios
failed        2      one SIP 500, one SIP 480, both zero duration
rejected      33     HTTP 429, no call_id, never dialled, not billed (§4)

second session, creates 15:20:26 to 18:25:39

placed        13     the dashboard was not read again, so no credit figure is stated
connected     8      two of them `ta-IN` (§7), one with a one-way audio leg (§8)
failed        5      three SIP 480 and two that did not connect, the last three in a row
rejected      0      no create was refused, so the concurrency block did not recur
```

The credits above are the first session's. The dashboard reading behind §10 was taken after
it and has not been repeated, so what the second session spent is not in this repository
and this report puts no number on it.

Sample sizes are small and are stated on every number below. Nothing here is offered as a
service-level characterisation of CALL-E; it is one account, two sessions on one day, one
route to India.

## 1. Request latency

Measured at the transport, wall clock from request sent to response received, over the
first session's 514 requests.

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

Seventeen responses in the first session came back **HTTP 429**. Not one carried
`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` or `X-RateLimit-Reset`. The
trace records an allowlist of those header names at the transport, before the SDK sees the
response, so this is not the SDK dropping them: the server does not send them.

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

Forty status observations were recorded across every call this project has placed with the
trace running: six creates in the first session, one probe create at 14:30:54 that showed
the concurrency block had cleared (§4), and thirteen in the second session. The denominator
is distinct `call_id` values across the fifteen trace files, twenty of them, and no id
appears in two files. A raw count of status records over everything else the workshop holds
comes out higher, because the receipts carry recipient and attempt statuses as well as call
ones. Twenty of the forty are the first status a create was seen in, and every one of those
was `queued`. The other twenty are that call's only other transition, and every one of them
was one of:

```
queued -> completed
queued -> failed
```

The documented `CallStatus` set has five values: `queued`, `in_progress`, `completed`,
`failed` and `canceled`. Three of them were ever seen. **`in_progress` and `canceled` are
documented statuses that no call has ever reached**, across those twenty production
creates. Nineteen of them were polled at a requested interval of 0.5 seconds, which §1
explains arrives as an effective second or more, and the probe create was polled every two
seconds. Twelve of the twenty ran for between 31 and 196 seconds, and nothing was ever
observed between acceptance and outcome. Either the two states do not exist behind the API
or they are not exposed. `dispatch/trace.py` says in its own docstring that it exists
partly to measure how long a call takes to reach `in_progress`, and the answer is that the
transition does not occur.

The consequence is that **a caller cannot tell a ringing phone from a connected one**. An
attendance office watching a queue of calls has exactly two things it can display, "sent"
and "done", and the forty seconds in between are a blank. That is the single change to
this API that would most improve what can be built on it.

Timing for the two calls of the first session that reached a terminal state through a full
poll:

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

The second session reproduced it, and produced the contrast in plainer form than either row
above. `S-3127` is the bicycle scenario dialled again. At its fifteenth turn of twenty-six,
stamped 56 seconds into an 82-second call (§9 on what that stamp is worth), the parent asks
**"Is he missing from the class?"**. The next two turns are the machine's: "Yes," and then
the attendance record read back. The call ran another 26 seconds, and the structured result
it returned recorded `parent_confirmed_aware: yes`, `reason_category: unknown`,
`expected_return: unknown`. The machine had the alarm in words, in its own answer, and
carried none of it into the fields. `S-3128`, the bus scenario dialled again, came back
`parent_confirmed_aware: no`, which is the only one of the four that the old rule would not
have closed on that field alone.

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

## 7. The Tamil the agent generates is not Tamil, and the Tamil it hears is

Two calls in the second session were placed in `ta-IN` against a Tamil-English
code-switching script. Together they separate a defect that neither could have settled
alone: what CALL-E hears is right and what it says is not.

**`S-3119` is the control, and the control is the finding.** An illness scenario: twenty
turns, six of them the caller's, 897 Tamil-script characters. The code-mixing came back
transcribed correctly, loanwords included, ஃபீவரா (fever), கிளீனிக் (clinic), ரெஸ்ட்
(rest), மார்னிங்ல (in the morning), ஸ்கூலுக்கு (to school), and the structured result was
right as well: illness, returning tomorrow, guardian confirmed. Speech recognition in
`ta-IN` works on this account and this route. The defect below is in output generation, not
in understanding the caller. Without this call the same evidence would read as "the model
cannot handle Tamil", which is a different claim and a weaker one.

**`S-3120` is the defect.** A missing-child scenario: fifty turns, thirty-four the agent's
and sixteen the caller's, and the caller's sixteen are coherent and answer what was asked.
The agent's are not Tamil.

மனதரம் is not a Tamil word, and it is the word this call is mostly made of. The agent used
it ten times in one call. The eleventh occurrence is the parent repeating it back to ask
what it meant, which the agent then confirmed. Counted on the `speaker` field CALL-E
returns with each turn, over the fifty turns of `S-3120`:

```
மனதரம்                 occurrences   turns carrying it
  agent  (`bot`)                 10                10
  parent (`user`)                 1                 1
```

The agent's ten are nine deliveries of one question and then an affirmation of it. Eight of
the nine are "உங்கள்க்கு மனதரம் இல்லையா? நான் இருக்கிறேன்." verbatim, the ninth is the same
question with a differently malformed pronoun and no second clause, and the tenth is
"ஆமாம், மனதரம்தான்.", in the table below. The parent echoes a variant spelling in two
further turns, so three of the caller's
sixteen turns are spent trying to make sense of a word that does not exist. The sentence
reads as a broken rendering of "can you hear me? I am here". Three exchanges around the
loop matter more than the loop itself:

| what the parent said | what the agent said next |
|---|---|
| the child took his school bag in the morning and left on his bicycle | "சரீ, அவசரம் இல்லை.", **"right, there is no hurry"** |
| "மனதரம், மனதிடம், ஆ மனதிடம் சொல்றீங்களா?", asking what the word is | "ஆமாம், மனதரம்தான்.", **"yes, it is [manatharam]"** |
| put me through to a human, to whichever staff is there | the broken sentence again, then "நான் காத்திருக்கிறேன்.", **"I am waiting"** |

A non-word, asked about directly by the person on the phone, confirmed as the word. The
parent said "புரியல" (I do not understand) repeatedly, asked for English, and asked five
times, in five separate turns, whether the child was in the classroom. The agent kept
asking for a return date, which is the narrow-remit behaviour `call-e-feedback.md` already
reports, now observed on live audio in Tamil.

The loop is not the only malformed output. Five transliterated non-words are marked across
the two calls, counted the same way. Every one of them is the agent's, and the only caller
occurrences anywhere in the corpus are the three echoes described above:

| non-word | row | agent occurrences | agent turns |
|---|---|---|---|
| `manatharam` | `S-3120` | 10 | 10 |
| `indhu` | `S-3120` | 3 | 2 |
| `indhum` | `S-3120` | 1 | 1 |
| `vilakappadavillai`, for விளக்கப்படவில்லை, "has not been explained" | `S-3120` | 1 | 1 |
| `maaranam`, for காரணம், "reason" | `S-3119` | 1 | 1 |

None of the five appears in any of the other eighteen published calls.
[`tools/glosses.json`](tools/glosses.json) carries a turn-by-turn gloss of every non-Latin
turn in the published calls, and its `_brackets` key records why those words are
transliterated rather than glossed to their probable intent: glossing மனதரம் as "can you
hear me" would hide the defect the call is published for.

What a school would experience. The call is `completed`. The structured result is
schema-valid: `parent_confirmed_aware=no` and every other field `unknown`. No field in the
response reports anything about the quality of the language the agent generated, and the
transcript is returned as text, so a caller reading the API alone cannot tell this call
from a call that simply went nowhere. So an attendance office sees an
undetermined call that needs a human callback, which is the same thing it sees after a bad
line or an evasive relative, and a Tamil-speaking parent of a missing child has been told
there is no hurry by a system that could not be understood or escaped. The call ended
because the operator hung up. The API has no field saying who ended a call, so that is
knowable only from the person who was on it.

This is CALL-E's and not this project's. The request carries a `locale` and a script;
everything else in the path is the same code that produced well-formed English output on
the call placed nine minutes earlier and the correct `ta-IN` transcript of `S-3119` four
minutes earlier. It
also lands on firstbell's own claim to call a family in the language it speaks, so it
publishes here as a disclosed limitation rather than as someone else's problem.

**What would let a caller detect it.** Nothing currently can. A language or confidence
figure on generated turns, rather than on transcribed ones, would be enough: a caller could
hold a call for review instead of filing it as undetermined. Failing that, a documented
statement of which locales are supported for generation as against transcription would let
an integrator decline to offer one.

The sample is two calls. Six `ta-IN` calls are published in total, and the gloss marks no
non-word in the four placed on 2026-09-04. That comparison is weaker than it looks: the
two glossing passes used different models on the same instruction (`_method` in the gloss
file names both), so the earlier four are not a matched control, and two calls cannot say
whether this is every Tamil call or this Tamil call.

## 8. A one-way audio leg is indistinguishable from a silent parent

`S-3118` connected, ran **31.0 seconds**, and returned five turns, all of them the agent's.
The structured result came back with every field `unknown`.

CALL-E records the two legs on separate channels of the recording it returns, the agent
outbound on the left and the caller inbound on the right. That separation is the platform's
and it is what makes this measurable per leg rather than a matter of opinion; the threshold
below is this report's, and it is stated so the measurement can be repeated. Measured on the
returned WAV in 100 ms frames at a threshold of -40 dBFS:

```
S-3118   outbound leg   12.3 s of audio in 8 bursts, peak  -7.7 dBFS
         inbound leg     0.4 s of audio in 3 bursts, peak -21.5 dBFS
```

The inbound bursts are 0.1 s at 19.0 s, and 0.2 s and 0.1 s at 27.0 s, the last two landing
directly after the agent asked whether it was speaking to a parent or guardian. The same
measurement over the other eleven recordings of 2026-09-11 gives an inbound total between
5.3 s (`S-3130`, 13 bursts) and 48.4 s (`S-3120`, 64 bursts), median 14.4 s, on the same
account, the same route and the same handset.

**An earlier reading of this call was wrong, and the correction is the reason the section
is here.** That reading was that the platform returned a transcript with the caller's
speech missing from it. The transcript is accurate. The parent's channel genuinely carried
almost no audio, so there was almost nothing to transcribe, and the receipt's note for this
call, that the platform returned five of its own turns and none of the parent's, describes
what the transcript contains rather than accusing it of omitting anything.

The defect is what the API does not say. A one-way audio failure and a parent who answered
and stayed silent arrive identically: `status=completed`, a duration in the same range, a
transcript of the agent's turns only, every extracted field `unknown`, and no signal
anywhere in the response about the media path. Those two need opposite follow-up. A silent
parent is a person to try again later or visit; a dead inbound leg is a fault to report,
and the same call placed again may work. A school running this at scale cannot separate
them without listening to every recording, which is the labour the automation exists to
remove.

Whether this call was billed is an open question. §10 establishes that the zero-duration
failures were not charged, but this call was not zero duration and the dashboard reading
behind §10 was taken before it. It is not verified either way here.

**What would let a caller detect it.** Per-leg audio presence, or even a single flag saying
no inbound media was received, turns this from an unexplained undetermined call into an
actionable one. The recording carries the evidence already, so the platform holds
everything needed to say it.

## 9. A turn's stamp does not locate it in the recording

Each transcript turn carries a `speaker` of `bot` or `user` and an integer
`offset_seconds`, both of them CALL-E's values. The text is trustworthy; §7 is built on it
and §6 quotes it. The stamps are not, and the same measurement that settled §8 shows why.

Grouping each channel of the twelve recordings of 2026-09-11 into utterances, at the same
100 ms frames and -40 dBFS threshold as §8, joining anything separated by 0.6 seconds or
less and dropping anything shorter than 0.3 seconds:

```
caller turns reported                                       74
caller utterances on the inbound channel                    94
caller turns whose stamp has no inbound audio within 1 s    43
                                        within 5 s          13
signed stamp error, caller turns          3.8 s early to 26.0 s late, median 0.2 s late
calls with both channels speaking at once    11 of 12, from 1.3 s to 22.4 s per call
```

The median is fine and the tail is not, which is the shape that makes a stamp unusable: a
client cannot know which of its turns is the one that is 26 seconds out. The grouping
parameters move the counts, and they are stated for that reason; widening the window to 5
seconds still leaves 13 caller turns with no caller audio anywhere near them.

The clearest single instance is in the exchange §6 quotes. The `user` turn stamped 56
seconds in `S-3127` has no inbound audio between 52.9 and 58.8 seconds, and the `bot` turn
stamped the same second has its audio at 57.5. Two turns, one stamp, and neither of them
where the stamp says.

**Two consequences, and the second is a caution against a reading this report cannot
support.** Anything that reasons over turns by time inherits this: seeking a recording to a
stamp, measuring who held the floor, or deciding who interrupted whom. The turn counts in
this document, including §7's, are counts of what the platform chose to segment rather than
of utterances, and the two differ by 74 against 94 on the caller's side alone.

The second is about the speaker labels. The phrase "I didn't get that" opens three of the
370 published turns and all three are labelled `user`, in three different calls; it appears
on no `bot` turn anywhere in the corpus. It is also exactly the sort of phrase a machine
says when it fails to parse a reply, and in `S-3127` it opens the same turn as the parent's
question, at a moment when both channels carry speech for 5.5 seconds together. So a
diarisation merge, one turn carrying a fragment from each side, is possible there and is
**not established**. Nothing in the files decides it: the labels cannot be checked against
the audio without a person listening to the recording, which is itself the finding worth
acting on. A caller cannot verify a speaker label from the API, and on overlapping speech it
should not assume one.

## 10. Billing: the flat price is gone, and the failures are not charged

The dashboard was read after the first session, on 2026-09-11, which settles every question
the previous version of this section left open and raises a larger one. Every figure in this
section is that reading. It has not been repeated since the second session, so nothing here
covers the thirteen calls that session placed.

The account is denominated in credits, and the conversion is fixed by the top-up: **+$10.00
bought 1,000 credits** on 2026-09-09, so one credit is one cent. That rate also reconciles
the earlier period, which the panel showed in dollars: thirteen events at 5 credits is 65
credits, and 65 credits is the $0.65 recorded in
[`evidence/observed-price.json`](evidence/observed-price.json).

```
available balance      783 credits
total period cost      317 credits   = 65 (2026-09-04) + 252 (the first session)
```

The balance closes exactly against the earlier reading. The account held 1,035 credits after
the 2026-09-09 top-up, the first session settled 252, and 1,035 − 252 = 783. Nothing is
unaccounted for, which is worth saying because the 2026-09-04 reconciliation was not able
to say it.

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
credits it is not: over the twelve calls pooled in
[`evidence/recorded-calls.json`](evidence/recorded-calls.json), which is the denominator
that file still carries and does not yet include the second session, the desk time removed
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

The honest limits: one account, two sessions on one day, one destination country, twenty
creates and 1,512 reads, of which the latency table in §1 is the first session's 514
requests. The latency distributions are usable; the failure-code table is three
observations; §6 is four calls, §7 is two calls and §8 is one, and each of them needs more
before it is a rate rather than a demonstration. §9's counts are over twelve recordings and
74 caller turns, which is enough to say the stamps are unreliable and not enough to say why.
Every call went to one handset on one route, which is the limit that matters most for §8.
Interruption, background noise and an evasive relative are still unrun, and they are the scenarios most likely to produce a
finding these two sessions have not.
