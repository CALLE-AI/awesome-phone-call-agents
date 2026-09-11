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

A confirmation is bound to the window as well. The window is checked before the
call goes out and again on the result that comes back, on two clocks. This run's
clock catches an answer that landed after the round could act on it. The call's own
`completed_at` catches a call that finished outside this window at all, which is
what a replayed idempotency key hands back. The provider timestamp is allowed a
minute of skew at each end, because it is somebody else's clock. A confirmation
outside the window is not a confirmation and the run ends as `window_expired`. The
person still said yes on a phone call, so they are still owed the release call that
says it is off.

Who said yes is read from the transcript and never from the call status. A call
CALL-E reports as `failed` or `canceled` can hold the confirmation question and a
yes after it, which is what a line dropping after somebody agrees looks like.
Reading the status as proof that nobody committed would let a provider error code
cancel a duty to a person, which is the failure this whole protocol exists to
prevent, so that yes earns its release call exactly like any other. The yes still
has to come after the confirmation question with no machine on the line: what
counts is what the person answered.

Only a window check may be reported as a closed window. A yes refused because the
completion time could not be read, because the confidence floor rejected it or
because the call itself failed ends the run as `not_confirmed` with the refusal
named in the note. `window_expired` is kept for `late_result` and
`outside_window`, the two refusals the window is responsible for, so a record
never names a check that did not happen.

Both clocks have to be readable for that check to mean anything. The completion
time is read first, before either clock. A `completed_at` that is missing, null,
empty, unparseable or not a string at all is refused as `completion_time_unknown`
rather than waved through, because otherwise a replayed call with no usable
timestamp would satisfy any window it was measured against. Checking it first is
what stops a ledger line claiming the window was weighed against a time nobody
could read. `completion_time_usable` records that alongside the verdict. The
other refusals keep their own reasons, `no_window`, `late_result` or
`outside_window`, so a line that failed for want of a timestamp does not read like
a plain expired window.

## When a call cannot be accounted for

CALL-E failures split in two and the split is the whole point.

A reply the server chose to send to a first attempt is definite. A 400, a 402 or a
404 says the call was not created, so the phase reads it as a refusal and the
protocol carries on.

Anything else may be sitting on top of a call that is live. No reply at all, a
request timeout, a 429, a 409 on the idempotency key, a 5xx, a read that fails
after the create got through and a call CALL-E has not finished with are all
handled the same way: re-issue the same idempotency key. That is the one request
that cannot ring a second time, because the key is the reservation, so CALL-E
answers with the call it already holds for it.

Getting that call back is the only thing that resolves the ambiguity. Once one
attempt is unanswered, the class of the second answer stops carrying information:
a 401 or a 403 can be decided before the idempotency lookup, and the request that
went unanswered may already have been accepted. So any second failure leaves the
call `unresolved`. Then the run stops. It keeps whatever call id is known, records
the status as `unresolved` rather than as an error or as a normal nonterminal
result, names the call in the outcome note and calls nobody else. In the confirm
phase that ordering is the safety property: a call that might still agree the time
must not be followed by release calls saying it is off. Everybody who already said
yes is recorded in `unreleased` and `resume` places those calls once the open one is
settled.

The release phase is the exception to stopping. Once the appointment is off, each
release call is a separate duty to a separate person, so an unresolved release call
leaves that party listed as still owed and the round carries on to the others.
Stopping there would leave people who agreed to a time believing it is going ahead.

## Phase 3, release

If any party does not confirm, nothing is arranged and every party who already
confirmed is called back and told so, most recent first. The call leaves no new
time and asks for nothing.

Release calls ignore the coordination window. The window governs how long it is
sensible to keep gathering and confirming. Telling somebody their afternoon is
free again is a duty and it does not expire because a timer did. The call budget
and the party's calling hours still apply and a party who cannot be called inside
either is listed in `unreleased` for a human to chase. A duty to tell somebody is
not a licence to ring them at 3am.

The debt clears on delivery and nothing else. A person has to be on the line and
the transcript has to carry the acknowledgment, the same way a commitment has to
come from the transcript. The extracted answer can veto that acknowledgment and it
can never create one: an extraction the recording does not support is not somebody
being told. This is the single boolean that writes off what the app owes them.
A release call that failed, that reached a machine or that ended with nothing
acknowledged leaves the party owed. `resume` places that call again.

## Canceling in flight

`run` takes an `AbortSignal` and the CLI wires Ctrl-C to it. Once it fires no new
gather or confirm call is placed, but the release round still runs: canceling the
appointment does not cancel the duty to tell anybody who said yes. A second
interrupt gives up on that too.

No create goes out after the signal has fired, the reconciliation of an ambiguous
create included. That one is easy to miss, because it does not look like a new call:
the first create came back ambiguous and the same key is sent again to find the call
CALL-E may already hold. It is still a create and if the first request never landed
it places the call, so doing it after a cancellation starts the call the cancellation
was meant to stop. The two cases are not recorded the same way either. Before the
first create nothing has been sent, so no key is claimed and the call reads as never
placed. Before the reconciliation the first request may already have been accepted,
so the call is left unresolved under the key already on disk and `resume` settles it.

The Developer API has no cancel endpoint, so a call that is already connected
cannot be hung up. It is recorded with the status it had, which makes it unsettled,
and `resume` settles it.

## One coordination, one ledger, one round

A ledger is the coordination's durable state, not a log beside it. The attempt number
in every idempotency key is counted from that file, so a `run` pointed at a ledger
which already records a round is not a fresh start: each gather and confirm call
derives a key one attempt higher, CALL-E has never seen that key, and every party is
rung again about an answer already on disk.

On an interrupted ledger it is worse than a duplicate call. The second round closes
the file with a clean outcome of its own, so a release call the first round owed
somebody is written out of the history and nobody is left to place it.

So a run reads the ledger under its own lock before it dials anybody, and there are
three answers and no fourth.

- A round that finished with every call settled is handed back as it stands. No call
  is placed and nothing is appended, so running twice is reading twice and the file
  still replays as one round. The outcome, the slot, who confirmed and the call count
  are the recorded ones: this run placed nothing, and claiming a call of its own would
  be a call in the accounting and none on a phone.
- A round that did not finish, or that finished still owing somebody a release call,
  belongs to `resume`. That is the one path that settles a call by sending the key it
  went out under, so the refusal names it.
- A file that is not this coordination's is refused outright. Another request's
  digest, lines no `run_started` opens, or a torn last line, which is what a crash
  during an append leaves and is itself evidence that a run stopped there. `resume`
  repairs that line under the lock.

A new coordination goes in a new file, which is what makes a ledger the coordination
rather than a scratch pad.

## What may mint a new attempt key

One rule, and both places in the app that derive a key ask it, so a fresh coordination
and a recovery cannot answer it differently. Recovery derives no key at all: it
re-issues the string the ledger recorded.

A key is minted for a call this ledger holds no attempt for. The single exception is a
release retry that was asked for and whose last attempt is settled.

Nothing else, and that is the rule rather than a carve-out. A gather or a confirm call
is placed once per coordination, so a second attempt at one is a second phone call
about an answer the ledger already holds: an outcome settled on disk is read, never
coordinated again. A release call is the one call this app places twice, because a
release nobody acknowledged leaves the person owed, and even then two things have to
hold. The last attempt has to be accounted for, since one that may still be on the
phone to somebody is reconciled under its own key instead. And the retry has to be
asked for, with `resume --retry-release`, because a new key is a handset ringing rather
than a lookup and nothing else recovery does can reach anybody who is not already
being called. Without it the debt is reported and stays owed.

## Recovery

The ledger is not only there to be read back. A process can die between the call
that got a yes and the call that owes the apology and a create response can be
lost while the call itself goes ahead. Both leave somebody expecting an
appointment that is not happening, which is the one failure this protocol exists
to prevent.

There is a narrower window inside `placeCall` itself. It sends the create and
waits. The caller only appends the gather or commit entry once that wait comes
back, so a process death after CALL-E accepted the call and before that append used
to leave nothing at all: no key to re-issue and no id to read. Two lines close it,
both written by `placeCall` rather than by its caller:

- `call_attempt`, before the create. It carries the phase, the party, the masked
  number, the slot, which attempt at that call it is, the exact `Idempotency-Key`, a
  sha256 of the canonical JSON of the payload that key was taken over and the
  provider origin and account digest it is being sent to. The payload digest is what
  makes the record content bound: given the request and this code the payload can be
  recomputed, so the record can be shown to belong to that call rather than merely to
  a party and a phase. The provider fields say which namespace the key lives in, since
  a key means that call at one provider under one account and nowhere else. One record
  per call, because an ambiguous create re-issues the same key with the same payload,
  which is the same attempt.
- `call_accepted`, as soon as a create returns an id and before anything waits on
  the call. A crash during the wait then leaves an id that can be read rather than
  a key that has to be re-issued.

Neither line records an answer and neither counts as a call placed. The phase entry
that follows is still the only thing that says what a call did.

`resume --request <file> --ledger <file> --live` reads the ledger and:

- refuses to touch it unless the request digest matches. The digest is taken over
  the request whole, so the id, the meeting, the policy, every slot field and every
  party field are bound. A field added to the request later is bound the day it is
  added. Earlier versions of it named the fields to bind and every list left one
  out: the party fields first, then `request_id`, which is what every idempotency
  key starts with. That matters because a create with no call id is rebuilt from
  the request in hand, so an edit the digest waved through would build a different
  payload, take a different key with it and place a fresh call to somebody while
  the original ambiguous call might still be live
- settles every call the ledger cannot account for. A call with an id is settled by
  asking for it, which places nothing. A call with no id, which is what a lost
  create response leaves, is settled by re-issuing the key the ledger recorded for
  that call: CALL-E answers with the call it already has or places the one the run
  owed. That is charged to the call budget, because from the outside the two cannot
  be told apart. The key is read rather than derived a second time. Deriving it
  reads the task text and the task text lives in this repo, not in the request, so a
  crash, an upgrade that touched one line of a call script, then a resume would
  derive a new key and ring a second phone
- refuses a call with neither an id nor a recorded key. Only a ledger written before
  the key was recorded can hold one. The key could be derived. Nothing on disk says
  the derived string is the one the lost create used, so the choice is between a call
  that may be a duplicate and a line in the note asking a person to check. It takes
  the note. A duplicate confirm call rings somebody who may be on the line already.
  The run still tells everybody who said yes that it is off, so refusing costs a
  manual check rather than a duty
- refuses to re-issue a key whose payload no longer matches. The digest recorded with
  that key is compared against the payload this build would send under it. They differ
  when a call script or a result contract moved between the crash and the resume and
  the danger is the case where the first request never reached CALL-E: the key is
  unknown there, so nothing is replayed and the create simply places a call saying
  whatever this build now says. Fail closed and name it for a person
- refuses to re-issue a key against another provider origin or another account. Both
  are recorded with the key. An `Idempotency-Key` is a reservation inside one
  namespace, so the same string sent elsewhere reserves nothing: it creates the call
  there while the original stays ambiguous where it was placed, which is two calls to
  one person wearing the look of a reconciliation. A different `--base-url` or a
  different `CALLE_API_KEY` on the resume is all it takes
- mints a new attempt at a call in one case only, a release retry that
  `--retry-release` asked for and whose last attempt is settled. The attempt number is
  part of the key, so a new one is a call the provider has never seen. That is only
  correct once the last outcome is known: while it is not, the key that attempt went
  out under is re-issued instead. Everything else recovery sends is a key the ledger
  recorded
- places the release calls that are owed, most recent yes first
- writes a fresh outcome entry, so the ledger still replays as one history

It never gathers availability again and never chooses a different slot. Once any
release call has gone out the appointment stays off, so a yes discovered late
cannot bring it back. A confirm call for a slot that has already started is not
placed at all. Anything it cannot settle is named in the outcome note for a person
to check by hand.

Recovery owns exactly the confirm and release calls the ledger cannot account for,
which includes every call recorded as `unresolved` and every attempt with no result
behind it. While one of those is a confirm call, `resume` decides nothing and places
no release call either: it reports the outcome as `unresolved` again, with the debt
still recorded, so a later run can settle it. A gather call is not recovery's to
finish, because nothing is owed to anybody from a gather call and `resume` never
gathers again, so the run names that call for a person to check instead. That holds
whether the gather call was recorded as unresolved or left as an attempt nothing
answered.

## Consent and calling hours

Every party needs `consent_recorded: true` or the request is refused before a
single call. Every party carries a calling window, checked in its own zone before
each call, defaulting to 09:00 to 20:00 in the meeting timezone. A window that
wraps past midnight is refused rather than guessed. A call the window refuses is
not a failure and costs nothing from the budget: it simply is not placed.

## What a call will not do

Every script, in all three phases, refuses the same things: no medical, legal or
financial advice and no opinion on any of them, no payment or card or bank
details and anybody who says there is an emergency is told to hang up and call
their local emergency number. Those lines are in the task text the agent follows
and there is a test for each phase.

## Reading what people said

| Question | What leads | Why |
| --- | --- | --- |
| Which options work? | CALL-E's extracted `available_options`, cross-checked against a local read of the transcript. Only options both sources contain are credited. | A list is what an extraction model is good at. Requiring the transcript to contain the same option numbers means a mishearing cannot invent a free slot. When the two disagree the overlap is kept and the disagreement is recorded. |
| Did they confirm? | The transcript, after the turn that asked the confirmation question. The extracted answer can veto a confirmation, never create one. | A summary can flatten "well, maybe" into a yes and an early "yes, speaking" is not an answer to a question nobody has asked yet. A commitment has to be something the person actually said, about the time they were read. |
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

Every call carries `mps-<request_id>-<phase>-<party>[-<slot>]-<digest>-a<attempt>` as
its `Idempotency-Key`. The identifiers say which call it is. The digest is the first 12
hex characters of a sha256 over the canonical JSON of the payload that determines
the call: the task text, the result contract, the recipient and the metadata. It
uses the same canonical JSON the ledger uses for its request digest. The attempt is
which try at that call this is, counted from the ledger.

Identifiers alone were not enough. Two runs with an edited script would share a
key, so CALL-E would either replay the old call or reject the new body with
`idempotency_conflict`. With the digest in the key, the same words reuse the same
call and different words get their own key.

The attempt number is there because everything else is stable across attempts by
design and one call is placed more than once. A release call that ended without
reaching a person leaves the debt owed, so the round calls again. Deriving the key
again produced the string the first attempt had used, CALL-E answered with the call
that reached the machine and nobody was called: a second ledger line and a second
charge against the budget looked like a retry from the inside. The number comes from
the ledger rather than from the process and it only moves once the previous attempt's
outcome is known. While an attempt is unaccounted for, the person stays owed and that
attempt is reconciled under its own key, because a second call to somebody who may be
on the first one is what the whole protocol is built to avoid.

Counted from the ledger is not the same as one more than the ledger holds. A run
pointed at a coordination the file already records would step the number on every key
in it, which is every party rung again, so such a ledger is returned or handed to
`resume` rather than run, and the only number that ever moves is a release retry's,
once somebody asks for it. Both rules are above, in **One coordination, one ledger, one
round** and **What may mint a new attempt key**.

That last property is also why recovery does not derive the key a second time.
Every call entry in the ledger records the key its call went out under. The key
reaches the ledger before the create does, so it is on disk before it can have been
used. `resume` sends that string back verbatim. A key derived again would read the
task text out of this repo, so a run that crashed, an upgrade that touched one line
of a script, then a resume would produce a key CALL-E has never seen and place a
second call.

Re-issuing the recorded key is safe only while the key still stands for the same
request to the same provider, so both are checked before it goes back on the wire.
When CALL-E already holds the key, the same body hands back the same call and a body
that no longer matches is refused with `idempotency_conflict`, which is ambiguous, so
the round stops with the call unresolved rather than dialling anybody. When it does
not hold the key, which is exactly the case recovery exists for, none of that applies:
the create places a call with whatever body is sent. So the payload digest recorded
with the key is compared against the payload this build would send and the provider
origin and account are compared with the port in hand. A mismatch on any of them is a
refusal and a line in the note. An unsettled call with no recorded key at all or with
a key no attempt record stands behind, is refused for the same reason rather than
dialled under a string nothing vouches for.

The keys are the reservation that stops a person being dialled twice and that
reservation lives at CALL-E. The ledger is not a substitute for it. What the ledger
does have is a lock: a run creates `<ledger>.lock` with `O_EXCL` before it dials
anybody and holds it until it finishes, so two processes cannot interleave their
lines into one history.

## The ledger

One JSON line per event: `run_started`, `call_attempt`, `call_accepted`, `gather`,
`slot_chosen`, `commit`, `release`, `resume_started`, `reconcile`, `outcome`. Each
`gather` entry stores the feasible set before and after it, plus the recorded
answer. Every entry for a call records the idempotency key that call went out under,
which is what lets recovery settle a create whose response was lost without deriving
a new key. `call_attempt` and `call_accepted` are the two written before the answer
is known, which is what keeps a call that was accepted from vanishing with the
process. Neither is a call placed for accounting: the phase entry is. A `reconcile`
entry records a call `resume` settled and says whether settling it had to place a
call, which is what keeps the budget honest.

`replay` recomputes the whole run from those answers and reports the first thing
that does not follow: a feasible set that grew, a chosen slot the answers do not
support, a confirmation that is missing from a confirmed outcome, a run that ended
in anything other than a confirmation without releasing everybody who said yes or
naming them in `unreleased`, a call count that does not match the entries or an
attempt with no result behind it. That last one is the crash window: the call may
have gone ahead, so the history cannot say what happened on the phone whatever its
outcome line claims. It is reported by party and phase, with the accepted call id
when there is one.

A ledger can hold more than one round. A crashed or canceled run leaves no outcome
entry, `resume` opens a `resume_started` entry and closes with a fresh outcome, and
replay folds the rounds in order and reports the last outcome. Entries that follow
an outcome without a `resume_started` opening a new round are reported as a
problem, which is the check a second `run` against a finished ledger used to trip.
The call count comes from the entries, so a call whose entry never reached the disk
is invisible to it.

That last set of checks is the reason the ledger is worth keeping. A log that says
`verbally_confirmed` proves nothing on its own.

## Data handling

Stored: party id, the phone number masked to country code plus the last two
digits, the CALL-E call id and provider call id, the idempotency key the call was
placed under, a sha256 of the call payload, the option numbers, the decisive turns
and the outcome.

Not stored: the full phone number, the full transcript, the API key. The payload
digest is a hash, not the payload, so the task text and the recipient are not in the
file either.
