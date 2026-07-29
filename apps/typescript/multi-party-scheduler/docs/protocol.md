# The protocol

Three phases, one call per party per phase and a rule for every way a phone call
can fail to give you an answer.

## Phase 1, gather

One call per party, in the order the request file lists them. The call reads the
options that are still feasible, asks which of them the person could do and says
plainly that nothing is booked yet.

After each answer the feasible set is intersected with what that party can do. The
set only shrinks, so:

- the next party hears a shorter list, which makes the call shorter
- an impossible schedule is found on the call that makes it impossible, not after
  everybody has been rung
- option numbers never move. Option two is the same instant on every call and in
  the ledger

If the set becomes empty the run stops. It stops as `no_common_slot` when the last
answer came from a person and as `not_reached` when it came from a machine, a
silence or an API error. Those are different problems and they need different
follow-ups, so they are not collapsed into one.

## Phase 2, confirm

The earliest slot still standing is chosen. Ties cannot happen because two slots
at the same instant are refused when the request is loaded.

One call per party names that single time and asks for one word back. Everybody
confirming is the only path to `booked`.

## Phase 3, release

If any party does not confirm, nothing is booked and every party who already
confirmed is called back and told so, most recent first. The call leaves no new
time and asks for nothing.

Release calls ignore the coordination window. The window governs how long it is
sensible to keep gathering and confirming. Telling somebody their afternoon is
free again is a duty and it does not expire because a timer did. The call budget
still applies and a party who cannot be reached with the release call is listed
in `unreleased` for a human to chase.

## Reading what people said

| Question | What leads | Why |
| --- | --- | --- |
| Which options work? | CALL-E's extracted `available_options`, cross-checked against a local read of the transcript. Only options both sources contain are credited. | A list is what an extraction model is good at. Requiring the transcript to contain the same option numbers means a mishearing cannot invent a free slot. When the two disagree the overlap is kept and the disagreement is recorded. |
| Did they confirm? | The transcript. The extracted answer can veto a confirmation, never create one. | A summary can flatten "well, maybe" into a yes. A commitment has to be something the person actually said. |
| Was it a person at all? | Only turns labelled `user`, with voicemail and menu language treated as a machine. | A list of options the caller read out must never be scored as the person choosing them. |

When CALL-E cannot produce a schema-valid result at all, which the API documents
as a real outcome, the transcript read is used on its own and the ledger records
that it happened. Refusing to proceed there would fail for the wrong reason.

A completion confidence below `policy.min_confidence` discards the answer for that
call. Conservative in the same direction as everything else: the cost of a missed
slot is a follow-up, the cost of a wrong slot is three people at the wrong place.

## The call budget

Worst case is `2n + (n - 1)`: gather everybody, confirm everybody, release
everybody who had confirmed. For three parties that is eight calls. The request is
refused at load time when `policy.max_calls` is below the worst case, so a run
never starts a protocol it cannot finish.

Best case is `2` when the first answer rules everything out and `n + 1` when a
gather round narrows to nothing on the last party.

If the budget runs out mid-run the outcome is `budget_exhausted` and any party
who confirmed but could not be released is reported in `unreleased`.

## Idempotency

Every call carries `mps-<request_id>-<phase>-<party>[-<slot>]` as its
`Idempotency-Key`. A retried run reuses the calls it already placed instead of
ringing people twice. The keys are also what makes a crashed run safe to restart.

## The ledger

One JSON line per event: `run_started`, `gather`, `slot_chosen`, `commit`,
`release`, `outcome`. Each `gather` entry stores the feasible set before and after
it, plus the recorded answer.

`replay` recomputes the whole run from those answers and reports the first thing
that does not follow: a feasible set that grew, a chosen slot the answers do not
support, a booking with a missing confirmation, a failed run that never released
somebody who said yes or a call count that does not match the entries.

That last set of checks is the reason the ledger is worth keeping. A log that says
`booked` proves nothing on its own.

## Data handling

Stored: party id, the phone number masked to country code plus the last two
digits, the CALL-E call id and provider call id, the option numbers, the decisive
turns and the outcome.

Not stored: the full phone number, the full transcript, the API key.
