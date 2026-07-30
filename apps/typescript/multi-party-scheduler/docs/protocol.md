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

One call per party names that single time and asks for one word back. Every party
confirming is the only path to `verbally_confirmed`, which is the strongest thing
this app can say: everybody said yes on a call. No calendar is written and no
booking is created anywhere, so the outcome is never called `booked`.

A confirmation is bound to the question. The reader finds the turn where the
caller asked "can I confirm that time" and only a later turn can confirm it, so
"yes, speaking" while the caller is still saying hello is not agreement to a time
the person has not heard yet. A decline counts wherever it appears in the call: it
can only stop a commitment, never create one.

## Phase 3, release

If any party does not confirm, nothing is arranged and every party who already
confirmed is called back and told so, most recent first. The call leaves no new
time and asks for nothing.

Release calls ignore the coordination window. The window governs how long it is
sensible to keep gathering and confirming. Telling somebody their afternoon is
free again is a duty and it does not expire because a timer did. The call budget
and the party's calling hours still apply, and a party who cannot be called inside
either is listed in `unreleased` for a human to chase. A duty to tell somebody is
not a licence to ring them at 3am.

## Cancelling in flight

`run` takes an `AbortSignal` and the CLI wires Ctrl-C to it. Once it fires no new
gather or confirm call is placed, but the release round still runs: cancelling the
appointment does not cancel the duty to tell anybody who said yes. A second
interrupt gives up on that too.

The Developer API has no cancel endpoint, so a call that is already connected
cannot be hung up. It is recorded with the status it had, which makes it unsettled,
and `resume` settles it.

## Recovery

The ledger is not only there to be read back. A process can die between the call
that got a yes and the call that owes the apology, and a create response can be
lost while the call itself goes ahead. Both leave somebody expecting an
appointment that is not happening, which is the one failure this protocol exists
to prevent.

`resume --request <file> --ledger <file> --live` reads the ledger and:

- refuses to touch it unless the request digest matches, because the same request
  is what rebuilds the same idempotency keys
- settles every call the ledger cannot account for. A call with an id is settled by
  asking for it, which places nothing. A call with no id, which is what a lost
  create response leaves, is settled by re-issuing the same idempotency key: CALL-E
  answers with the call it already has, or places the one the run owed. That is
  charged to the call budget, because from the outside the two cannot be told apart
- places the release calls that are owed, most recent yes first
- writes a fresh outcome entry, so the ledger still replays as one history

It never gathers availability again and never chooses a different slot. Once any
release call has gone out the appointment stays off, so a yes discovered late
cannot bring it back. A confirm call for a slot that has already started is not
placed at all. Anything it cannot settle is named in the outcome note for a person
to check by hand.

## Consent and calling hours

Every party needs `consent_recorded: true` or the request is refused before a
single call. Every party carries a calling window, checked in its own zone before
each call, defaulting to 09:00 to 20:00 in the meeting timezone. A window that
wraps past midnight is refused rather than guessed. A call the window refuses is
not a failure and costs nothing from the budget: it simply is not placed.

## What a call will not do

Every script, in all three phases, refuses the same things: no medical, legal or
financial advice and no opinion on any of them, no payment or card or bank
details, and anybody who says there is an emergency is told to hang up and call
their local emergency number. Those lines are in the task text the agent follows
and there is a test for each phase.

## Reading what people said

| Question | What leads | Why |
| --- | --- | --- |
| Which options work? | CALL-E's extracted `available_options`, cross-checked against a local read of the transcript. Only options both sources contain are credited. | A list is what an extraction model is good at. Requiring the transcript to contain the same option numbers means a mishearing cannot invent a free slot. When the two disagree the overlap is kept and the disagreement is recorded. |
| Did they confirm? | The transcript, after the turn that asked the confirmation question. The extracted answer can veto a confirmation, never create one. | A summary can flatten "well, maybe" into a yes, and an early "yes, speaking" is not an answer to a question nobody has asked yet. A commitment has to be something the person actually said, about the time they were read. |
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

Every call carries `mps-<request_id>-<phase>-<party>[-<slot>]-<digest>` as its
`Idempotency-Key`. The identifiers say which call it is. The digest is the first 12
hex characters of a sha256 over the canonical JSON of the payload that determines
the call: the task text, the result contract, the recipient and the metadata. It
uses the same canonical JSON the ledger uses for its request digest.

Identifiers alone were not enough. Two runs with an edited script would share a
key, so CALL-E would either replay the old call or reject the new body with
`idempotency_conflict`. With the digest in the key, the same words reuse the same
call and different words get their own key. That is also what makes recovery
possible: `resume` rebuilds the same payload and therefore the same key, so
settling a call cannot create a second one.

The keys are the reservation that stops a person being dialled twice, and that
reservation lives at CALL-E. The ledger is not a substitute for it. What the ledger
does have is a lock: a run creates `<ledger>.lock` with `O_EXCL` before it dials
anybody and holds it until it finishes, so two processes cannot interleave their
lines into one history.

## The ledger

One JSON line per event: `run_started`, `gather`, `slot_chosen`, `commit`,
`release`, `resume_started`, `reconcile`, `outcome`. Each `gather` entry stores the
feasible set before and after it, plus the recorded answer. A `reconcile` entry
records a call `resume` settled and says whether settling it had to place a call,
which is what keeps the budget honest.

`replay` recomputes the whole run from those answers and reports the first thing
that does not follow: a feasible set that grew, a chosen slot the answers do not
support, a confirmation that is missing from a confirmed outcome, a run that ended
in anything other than a confirmation without releasing everybody who said yes or
naming them in `unreleased`, or a call count that does not match the entries.

A ledger can hold more than one round. A crashed or cancelled run leaves no outcome
entry, `resume` opens a `resume_started` entry and closes with a fresh outcome, and
replay folds the rounds in order and reports the last outcome. Entries that follow
an outcome without a `resume_started` opening a new round are reported as a
problem. The call count comes from the entries, so a call whose entry never reached
the disk is invisible to it.

That last set of checks is the reason the ledger is worth keeping. A log that says
`verbally_confirmed` proves nothing on its own.

## Data handling

Stored: party id, the phone number masked to country code plus the last two
digits, the CALL-E call id and provider call id, the option numbers, the decisive
turns and the outcome.

Not stored: the full phone number, the full transcript, the API key.
