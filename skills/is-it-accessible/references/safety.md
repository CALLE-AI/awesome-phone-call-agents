# Safety

This skill makes real phone calls to real businesses on behalf of a real person.
Three parties can be harmed by getting it wrong: the person planning the visit,
the shift worker who answers, and the venue. These rules exist for all three.

## Consent to dial

**A profile on disk is not consent to dial.** Confirm with the person that they
want this specific call placed to this specific venue, now. A saved profile, a
prior call, or a venue in a shortlist is not standing permission.

Never place a call to:

- A number the person did not give or confirm.
- A domestic or personal number. This is for businesses and public venues.
- The same venue twice in one enquiry. A business rung repeatedly by the same
  tool is a nuisance, and the second answer will not be better than the first.

## Dry run is the default

Every invocation is a dry run against recorded answers unless `--real` is
passed. A dry run opens no socket, reads no credential, and transmits nothing —
a "dry run" that still sends the venue's phone number somewhere is not a dry
run.

| Control | Effect |
| --- | --- |
| *(no flag)* | Dry run. Nobody is called. |
| `--real` | Places a real call, after an interactive confirmation. |
| `--yes` | Skips the confirmation. Only when the person has already agreed to this exact call. |
| `IIA_FORCE_DRY_RUN=1` | Refuses every real call, whatever the flags say. |

`IIA_FORCE_DRY_RUN=1` is the process-wide brake: a shared, demo, or CI
environment can set it and be certain nothing dials out however the command line
is written. It overrides `--real` and says so on stderr.

Without a TTY and without `--yes`, the script refuses rather than assuming
consent it cannot obtain.

## Phone numbers

**E.164 only, and country codes are never inferred.** A number without a leading
`+` is rejected outright. Guessing a country code wrong means calling a stranger,
so an ambiguous number is an error, not a puzzle to solve.

Every number in a batch is validated *before* anyone is called. Discovering that
the third venue is malformed after ringing the first two is the worst possible
moment to find out.

**Numbers are masked everywhere but the dial.** Output shows `+1555555****`.
Full numbers exist only in the request to CALL-E. They never reach a report, a
log, a summary, or a terminal.

**Free text is scrubbed.** People read numbers aloud on the phone, so any run of
eight or more digits in a summary, note, or quote is replaced before it is
printed or stored. Short measurements survive — "70cm wide", "2 steps" — because
those are the substance of a finding, not personal data.

## What is never disclosed

The call says only that a customer is planning a visit. It never gives:

- The person's name.
- Their phone number or any contact detail.
- Their condition, diagnosis, or why they are asking.

If the venue asks who is calling or who the customer is, that boundary holds.
The `notes` field in a profile is read out only as visit context ("visiting on a
weekday afternoon") — never put identifying or medical information in it.

## Credentials

`CALLE_API_KEY` is read from the environment only. It is never a command-line
argument, where it would land in shell history. Never accept a key pasted into a
chat, never print one, and never write one into a file or a report.

## How the call is conducted

**It is a question, never an inspection.** The person answering did not design
the building and is not responsible for its shortcomings. The call:

- Identifies itself as an assistant calling on behalf of a customer.
- Implies no obligation and cites no law. This is not a compliance check and
  must never be framed as one.
- Offers to ring back if they are busy, and lets them go.
- Accepts "I don't know" as a real answer. One concrete follow-up when a reply
  is vague, then it moves on — a third push produces a made-up answer, which is
  worse than no answer.
- Asks for nothing else: no booking, no manager, no callback, no personal
  detail.

## No hidden schedules

One invocation, one round of calls. This skill creates no recurring job, no
cron entry, and no background poller. If someone wants repeat checks, create
them explicitly and tell the person how to stop them.

## Cancellation

Interrupt the process (Ctrl-C).

- **In a dry run**, nothing has happened.
- **During a real call**, interrupting stops *your wait*, not the call. CALL-E
  finishes it. Do not start a new one — that dials the venue a second time.
  The call id is printed the moment CALL-E accepts it, before the wait begins,
  and the same happens if the wait gives up (ten minutes unless `--wait` says
  otherwise; calls have taken two hours). Rebuild the report from that id,
  with no dial:

  ```bash
  node scripts/check_access.mjs --call call_… --profile alex.json
  ```

Retries are also protected: each check sends a stable `Idempotency-Key` that
hashes the profile id, the needs asked, the sorted venue numbers and the UTC
day, so the identical check run again today re-reads the original call rather
than ringing again. The one way to ring the same venue twice in a day is
`--again`, which mints a fresh key and must be asked for by name.

## Reporting honestly

**A positive claim with no supporting quote is recorded as `unknown`, not as a
fact.** Without this rule the skill launders whatever a venue felt like saying
into an authoritative green tick, and somebody plans a journey around it. A
`no` survives unevidenced — an unevidenced "no" costs a wasted enquiry, an
unevidenced "yes" costs a wasted journey.

**A barrier plus a workaround is not a clean pass.** A venue that says "there
are four steps, but we have a ramp" has not described a step-free entrance, and
recording that as `yes` is the same laundering by a different route — the
barrier is real, the workaround is unverified, and the person reading the green
tick is the one who finds out. The call asks for a count, and any non-zero
count caps the answer at `partial` however good the workaround sounds. The same
holds for a lift that is out of service, or an accessible toilet kept locked.

Unlike the quote rule above, this one is an instruction to the model rather
than something the report enforces. Read a `yes` on an essential whose note
mentions a barrier with suspicion, and say so rather than presenting it.

Check the run status and the report `verdict` before presenting anything. A call
that failed, went to voicemail, or was cut off can still carry a partially
filled summary; `verdict: "unverified"` with an `unverifiedReason` means nothing
was established, and saying otherwise is worse than saying nothing.

## Do not blame the venue for a call that was never placed

A failed call is not evidence about a venue until you know it reached one.
Calls can fail on the provider's side — a routing block returns a terminal
status with no phone ever ringing, and the call-level fields describing it are
identical to those of a call that genuinely rang out unanswered.

The report separates them in `callFailure`:

- `no-answer` — the phone rang and nobody picked up. The only one of the three
  that says anything about the venue.
- `not-placed` — the call never reached a phone. Nobody there heard it ring,
  and nobody there chose not to answer.
- `unclassified` — it is not possible to tell. Say that, rather than picking
  the likelier of the two.

Present the `unverifiedReason` as written. "They didn't answer" and "we
couldn't get through" are not paraphrases of one another: the first is an
accusation, and a person deciding where to spend their limited energy will act
on it by crossing the venue off. Where the call was not placed, say so, and say
that trying again is worth it.

The same asymmetry that governs the quote rule governs this. A vague sentence
costs a wasted retry; a wrong one costs a venue its reputation with somebody
who had no way to check.

Rank a low-confidence positive *below* a high-confidence negative.

## The standing caveat

Always present results with it:

> This records what staff said on the phone. It is not an inspection, an audit,
> or a legal determination, and people answer in good faith about buildings they
> did not design. Treat it as a much better starting point than a website, not
> as a guarantee.

Staff can be sincerely wrong. "Step-free" from someone who has never pushed a
wheelchair through the door is a real risk, and the quotes are what let a reader
judge for themselves. That is the mitigation, not a solution.
