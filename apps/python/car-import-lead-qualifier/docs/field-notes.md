# Field notes

What happened when this app was pointed at real phone lines, and what the results
changed in the code. Everything here comes from result files produced by
`qualifier/runner.py --execute`; those files are gitignored because they carry real
numbers, so nothing below is copied from them verbatim.

**Every phone number on this page is fictional.** The lines actually dialled belonged to
real people, so each one is replaced by a placeholder in the app's own reserved ranges,
used consistently: the same placeholder always stands for the same real line, so rows
that share a number here shared one in the campaign too. No digit of a real number
appears on this page, including in masked form — a mask that keeps a country prefix and
the last three digits still narrows a real subscriber.

No names, call ids, or idempotency keys appear either. Call ids are omitted deliberately:
they address a call record that the provider API will return a transcript for, so
publishing one would hand out the conversation this app takes care not to store. No
transcripts are stored: results deliberately exclude them, so these notes cannot quote a
call beyond the one-line `evidence` field the schema already redacts.

## The runs

Six executions across three leads, in two campaigns.

| Lead | Market | Outcome | Route | Confidence | Task completed |
| --- | --- | --- | --- | --- | --- |
| `lead-mz-live-3` | MZ `+258800000001` | called | `book_specialist_callback` | 0.86 `high` | yes |
| `lead-mz-live-2` | MZ `+258800000001` | called | `close_lead` | 0.93 `high` | yes |
| `calle-inbound-hotline` | US test line `+15550101234` | deferred | `retry_later` | — | — |
| `calle-inbound-hotline` | US test line | called, attempt 1 | `retry_later` | 0.66 `medium` | no |
| `calle-inbound-hotline` | US test line | called, attempt 2 | `retry_later` | 0.62 `medium` | no |
| `calle-inbound-hotline` | US test line | called, attempt 3 | `suppress_number` | 0.86 `high` | yes |

`lead-mz-live-2` and `lead-mz-live-3` are two inquiry records that resolved to the same
line, which is why one number covers both rows.

Between them the runs exercised five of the seven routes: `book_specialist_callback`,
`close_lead`, `retry_later`, `suppress_number`, and the business-hours deferral that
feeds `retry_later`.

## Conversion path

`lead-mz-live-3` is the first live call that reached the revenue route. The person
confirmed they submitted the inquiry, continued after the AI disclosure, said they were
ready to buy, described payment as being arranged in stages, gave a USD 20,000 budget,
**corrected the port** from the one on file to Nacala, and accepted a callback from a
human specialist. Route: `book_specialist_callback`, priority `high`.

The correction matters more than the conversion. It means the spoken script was
understood well enough to be argued with, not just tolerated — the person heard a wrong
detail and fixed it, and the structured result carries the fix rather than the stale
CRM value.

`lead-mz-live-2`, on the same market, is the mirror image: fully answered, high
confidence, `comparing` rather than ready, and an explicit `no` to a callback. Route
`close_lead`, no follow-up. A qualification workflow that cannot cleanly record a
"no thanks" is a workflow that will keep calling people, so this run is as important as
the conversion.

## Opt-out beats a completed task

Attempt 3 on the hotline lead came back with `task_completed: true` and 0.86 confidence
— a clean, successful call by every provider signal — and still routed to
`suppress_number`, because `right_person` was `no` and the person did not continue after
the AI disclosure.

That is `routing.py` evaluating opt-out signals before any commercial signal, working on
a real call rather than in a test. A completed call is not permission to call again.

## What the failed attempts taught

Attempts 1 and 2 on the hotline lead were declined immediately by the provider, with no
speech captured. Both returned `provider_status: failed` and `task_completed: false`,
and both routed to `retry_later` — correct, because CALL-E reports a decline both when a
person refuses and when the route failed before any media existed.

The detail worth keeping: **both failed calls still came back with a
`completion_confidence` of 0.66 and 0.62 `medium`**, despite no conversation having
happened. Confidence is not a liveness signal. Routing already reads `provider_status`
and `task_completed` first and only uses the score for the `manual_review` gate, which
is the right order — but anyone tempted to route on confidence alone should read those
two rows first.

The ladder also terminated the way it was designed to: three attempts, then the lead
stopped being redialled.

### What CALL-E found when this was reported

Both failures were reported upstream. CALL-E compared the three failed attempts against
successful calls to the same destination and confirmed that all three ended before media
was established: zero duration, and no ringing, connected, audio, or ASR events — only a
real-time hangup with code 504. SDK and CLI attempts used different API paths and caller
IDs and produced the same failure signature, and the CLI caller ID completed later calls
to the same hotline, so it was not a caller-ID block. Their assessment was an intermittent
timeout or availability problem on the hotline/inbound route.

They also confirmed the decline mapping this app had already coded around: **CALL-E maps a
failed ByCallee result to `DECLINED` even though the destination never actively declined,
because media was never established.** `TERMINAL_STATUSES` in `runner.py` lists `declined`
and `rejected` for exactly this reason, and `routing.py` decides what a decline is worth
rather than trusting the label.

A second report covered `calle call plan` timing out with `MCP request timed out for
tools/call`. CALL-E confirmed the CLI ships a 15-second default request timeout, close
enough to normal `plan_call` latency to fail; `--timeout-seconds 120` is the recommended
workaround.

Three issues track the separate resolution areas:

| Area | Issue |
| --- | --- |
| Hotline availability | [CALLE-AI/awesome-phone-call-agents#81](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/81) |
| CLI default timeout | [CALLE-AI/awesome-phone-call-agents#79](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/79) |
| Timeout troubleshooting docs | [CALLE-AI/awesome-phone-call-agents#80](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/80) |

One finding from these runs is **not** covered by any of the three: the two dead calls
still returned `completion_confidence` of 0.66 and 0.62 `medium`. CALL-E's own
investigation independently establishes that no media existed on those attempts, which
makes a `medium` confidence score on them harder to explain, not easier. Anyone routing
on confidence alone should treat that as unresolved.

One honest note on what was actually on the other end: the US test line answered with an
AI hotline agent that said it could not verify the inquiry. So the opt-out path above was
proved against an automated callee, not against a person declining. The routing logic is
the same either way, but the human version of that refusal is still untested.

## What these runs changed

Two defects surfaced only in live data, both fixed after the last run:

**Compound question dropped a field.** `lead-mz-live-3` answered everything except
`vehicle_type`, which came back `unknown` on an otherwise complete call — and the
`evidence` line never mentions a vehicle type at all. The cause was one question in
`task.py` asking two things at once ("Is that still what you want, and what type of
vehicle is it?"). The person confirmed the vehicle and the type was never collected.
The question is now split in two, and the schema description states that confirming the
inquiry vehicle is not by itself a type.

**Budget bands had open borders.** The same call reported USD 20,000, which sat exactly
on the line between `10k_20k` and `over_20k`; the spoken script offered "ten to twenty
thousand, or more than twenty thousand", ambiguous at the boundary in both directions.
It was recorded as `10k_20k`. The spoken options now read "ten up to twenty thousand, or
twenty thousand or more", and the schema states the convention: each band includes its
lower bound and excludes its upper one.

Neither is visible in a dry run. Both needed a real person answering in their own words.

## Still untested

- No live call has produced `payment_support` or `nurture_sequence`, so the payment-blocker
  branch — the one that motivated the whole route — has never routed on real speech.
- `manual_review` has been reached once on a live lead, on the attempt-exhaustion path
  recorded in the campaign state file. That run is not written up here because its result
  file was not retained, and the sub-0.8 confidence gate has still never fired live.
- The Angola, Tanzania, and Kenya markets were never dialled — only `+258` and the `+1`
  test line ever were. They have since been removed from `MARKETS` rather than shipped
  untested, so `destination_port` now lists ports for the only market served.
- The corrections above changed the script after the last live run, so the seven-question
  version has been tested only against the fake client.
