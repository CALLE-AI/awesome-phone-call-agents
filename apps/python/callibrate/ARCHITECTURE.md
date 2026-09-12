# Architecture

One loop, six steps, and nothing skips a step.

```
      trigger                    stale record, a failed referral, a person asking
         │
         ▼
  Verification Contract          which fields are in doubt, what counts as
         │                       evidence, what may change without a person
         ▼
  call eligibility               allowlist, suppression, consent, cap, spacing
         │                       ── if this refuses, CALL-E is never reached
         ▼
      CALL-E                     plan_call → run_call → get_call_run
         │
         ▼
   Call Evidence                 the transcript, normalised and read by rule
         │
         ▼
  evidence policy                REFRESH · APPLY · REVIEW · STOP
         │
    ┌────┴────┐
    ▼         ▼
 the record  a person
    └────┬────┘
         ▼
   evidence ledger               one hash-linked row either way
```

## The three seams

**`contracts/` is the boundary with the outside world.** A Verification Contract
is written before the phone rings and is readable, storable, diffable and
testable on its own. The same contract can be handed to CALL-E, to the pilot
line, or to a person with a clipboard, and be judged by the same rules
afterwards.

**`calling/` is the boundary with telephony.** Two implementations of one
interface: `CallEVerificationCaller`, which holds a real conversation, and
`PilotLineCaller`, which replays a scripted one. Both return `CallEvidence` and
neither returns an opinion. The safety argument does not depend on which ran.

**`policy/` is the boundary with authority.** It is the only thing that turns
evidence into permission to write, and it contains no model. Everything above it
proposes; this decides.

## Why `CallEvidence` and not an extraction result

The caller returns evidence, and evidence authorises nothing. Concretely:

- a `Claim` carries `source_turn_ids`, `readback_turn_ids` and
  `confirmation_turn_ids`, filled by the deterministic reader rather than by the
  caller, so every verdict traces to lines a person can read;
- `caller_result` keeps the caller's own account untouched, so a curator can
  compare what CALL-E said with what the transcript established;
- the policy reads the turn ids, never the account.

The reconciler has one rule that makes this hold: **it can only remove
confidence.** Where the transcript and the caller agree, the claim stands as the
transcript found it. Where they disagree, it is flagged. Where only the caller
proposes something, the claim survives with zero confidence and the reason
attached, so it reaches a person rather than being silently dropped or silently
trusted.

## Reading a conversation by rule

`evidence/transcript.py` does two jobs.

It **normalises**: CALL-E labels speakers `bot` and `user`, and on an outbound
verification call the `user` is whoever picked up the provider's phone. An
unrecognised label becomes `system`, never `provider`, because an unknown
speaker must not be able to satisfy a readback. Getting this wrong is not
cosmetic. The corroborator looks for a *provider* agreeing with an *assistant*,
so a mislabelled transcript would stop every automatic update with nothing
failing.

It **proposes**: "ten until one on Wednesdays" has to become `WE 10:00-13:00`
before it can be compared with the record. Digit clocks win where they exist and
close their own characters to the word pass; two times only make a range if the
words between them join them; a bare closing hour is promoted by twelve only
when that repairs an impossible range and leaves a plausible working day, so
`ten until one` is afternoon and `seven until seven` stays unreadable and goes
to a person.

`evidence/readback.py` then looks for the exchange a confirmed change claims
happened: the provider says it, the assistant says the whole of it back, the
provider agrees without hedging or correcting. All three, in that order.

## The transaction boundary

`store.record_verification` writes the run, the claims, the applied diff, the
review items and every ledger entry in one SQLite transaction. There is no state
in which a record has moved and the evidence for the move has not been written,
and none in which a curator sees a decision whose call was never recorded.

Failure has the same shape. Any exception between claiming a task and recording
it releases the task back to the queue with the reason attached; the record is
untouched, no half-written run appears, and the next attempt starts from the
state this one did.

One thing is deliberately written *outside* its transaction: a refused call. The
refusal audit is committed separately, because auditing it inside the
transaction that then raises would roll the entry back, and a refused call is
exactly what an operator needs to find in the ledger later.

## Surviving a crash mid-call

`run_call` is asynchronous and can return before the phone rings.

1. `reserve_call` writes a `call_runs` row **before** CALL-E is contacted.
2. `attach_calle_run` persists the `run_id` **before** the first poll.
3. Polling follows `get_call_run` to a terminal status.

A process that dies between 2 and 3 leaves a row that says a call is in flight.
`store.open_call_runs()` finds it, and the correct action is to read that run,
never to place another. A `run_call` that returns no `run_id` at all is
documented as unrecoverable without an explicit server `next_step`, so the
adapter escalates to an operator and does not retry.

## What was removed, and why

This application began as a directory that phoned providers over its own
telephony stack: a bidirectional voice model, media streams, a multi-agent
extraction graph, and a managed agent runtime. All of that is gone from the
primary path.

CALL-E owns the phone conversation. Callibrate owns why the call happens, what
must be established, what counts as evidence, and what software is permitted to
do afterwards. That division is why the whole architecture now fits in a diagram
a judge can read in ten seconds, and why the interesting code is the evidence
rules rather than the plumbing.
