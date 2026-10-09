# Adjudication

How one verified terminal call becomes exactly one disposition, and why each row of the
table is the way it is.

Implemented in `positive_contact/adjudicate.py`. Every row below has a named test in
`tests/test_adjudicate.py`.

## The shape of the decision

```text
verified re-read
      |
      +-- Judge A ----> contact_type, acknowledged   (structured result + call status)
      +-- Judge B ----> contact_type, acknowledged   (transcript, with the exact span)
      +-- confidence gate                            (label high, or score >= threshold)
      +-- Judge C (optional, only on disagreement, note only)
      |
      v
one Disposition: CONFIRMED | UNCONFIRMED | NEEDS_HUMAN, plus a reason code and evidence
```

The judges are deliberately not layered. Judge B is not a sanity check on Judge A; it is an
independent read of different evidence. A confirmation needs both of them to arrive at the
same answer on their own.

## Judge A: the structured result

Rule-based, over `recipients[0].structured_result`, the call `status`, and
`task_completed`.

Judge A does **not** infer voicemail from a status value. The CALL-E contract publishes no
answering-machine indicator: `CallStatus` is `queued | in_progress | completed | failed |
canceled`, `AttemptStatus` adds only `dialing`, and `failure_code` carries an explicit
instruction not to branch on its values. Inventing a voicemail signal from those would be
guessing, and the guess would be load-bearing.

If the result is missing, null, or fails the strict local validator, Judge A returns
`unknown/unknown` with reason `recipient_result_invalid`. It does not partially parse.

## Judge B: the transcript

Three things, in order.

**1. Machine greeting beats everything.** A `speaker=user` turn matching an answering
machine pattern marks the call as voicemail regardless of what Judge A says. A recording
cannot acknowledge anything, so no later turn can rescue it.

This lexicon is load-bearing, and an early version was too narrow. It covered `leave a
message`, `after the tone`, `you have reached` and a few more, which let a common greeting
through: "Hi, yes, this is the Smith family. We're not home right now. Please leave your
name and number." Judge B saw a live person, found "yes" in the greeting, agreed with a
structured result that also said live person, and the call was confirmed with the machine's
own greeting stored as the acknowledgement evidence. The lexicon now covers three families
rather than one: the imperative ("leave a/your", "record your message"), the absence family
("we're not home", "no one is available", "is unavailable"), and the callback promise
("get back to you", "try again later").

**2. The acknowledgement must come after the notice.** Judge B locates the notice turn:
the last `speaker=bot` turn matching a notice marker (`power ... turned off`, `public
safety power shutoff`, `confirm that you heard`, `received this notice`). Only recipient
turns after that index are candidates.

This matters more than it looks. The call opens with "Am I speaking with Maria or someone
in the household?" and the natural answer is "Yes, this is Maria." That "yes" is an answer
to the greeting, not an acknowledgement of a notice that has not been read out yet.
Counting it would confirm contacts who hung up before hearing anything.

**3. A negation before an acknowledgement wins; after it, does not.** Within a candidate
turn, Judge B compares the position of the earliest acknowledgement match against the
earliest negation match.

- "No, I did not hear anything about that" -> negation first -> not an acknowledgement.
- "Yes, I heard you, but I do not have a car to get to the centre" -> acknowledgement
  first -> an acknowledgement, with a caveat that is somebody else's problem.

Ordering by position rather than simple presence is what keeps a hedged yes from being
thrown away and a plain no from being read as a yes.

The negation lexicon has to match contractions, and getting that wrong is silent. It was
written as `\bn'?t\b`, which looks like it catches "didn't" and cannot: the character
before the "n" is a word character, so there is no word boundary there for `\b` to match.
Every contracted denial was invisible. "I couldn't hear a word. Correct?" found "correct"
in the acknowledgement lexicon, saw no negation, and confirmed the contact, quoting the
denial as the evidence. The pattern is now `n['\u2019]t\b`, which requires a literal
apostrophe so that ordinary words ending in "nt" - want, went, meant - are not read as
denials. `tests/test_regressions.py` asserts that a contraction and its expansion always
reach the same disposition.

When no candidate acknowledges and at least one denies, Judge B returns `live_person/no`
with the denial as evidence. When there are user turns but nothing conclusive, it returns
`live_person/unknown`. With no transcript at all it returns `unknown/unknown`.

`offset_seconds` is nullable in the contract, so ordering comes from array position and the
offset is only ever displayed.

## Judge C: optional, and deliberately weak

An interface, disabled by default, requiring `PC_ENABLE_JUDGE_C` to be set explicitly. It
is consulted **only** when A and B disagree, and its output is a string note attached to the
disposition for the human reviewer.

It cannot promote a disagreement to a confirmation. It cannot demote an agreement. There is
no code path where a model's opinion changes a disposition. That is the point: the
interesting judgement calls go to a person with a note attached, not to a third model whose
tiebreak nobody can audit.

Fixture and replay mode call no model at all.

## The confidence gate

Passes when `completion_confidence.label` case-folds to `high`, **or** when `score` is at
or above the threshold (0.80 by default).

`completion_confidence` is nullable until a terminal post-summary outcome exists, and
`label` is a free string in the contract with no published enum. So a null confidence
object, a missing score, and an unrecognised label all fail the gate. The unknown case can
never produce a confirmation.

## Agreement

```python
judges_agree = a.contact_type == b.contact_type and a.acknowledged == b.acknowledged
```

Note what this excludes. Judge B returning `unknown` is **not** agreement, even though it
did not contradict anything. If the transcript does not independently show the
acknowledgement, there is no confirmation, because the one rule is about transcript
evidence and not about the absence of objections.

The practical effect: every `CONFIRMED` row in the ledger has a quoted span behind it that
an operator, an auditor, or a regulator can read.

## The table, in evaluation order

First match wins. The order is the safety argument.

| # | Condition | Disposition | Reason code |
| --- | --- | --- | --- |
| 1 | `status` is not `completed` | NEEDS_HUMAN | `terminal_status_{status}_no_auto_redial` |
| 2 | recipient result missing, null, or invalid | NEEDS_HUMAN | `recipient_result_invalid` |
| 3 | Judge B says voicemail while Judge A claims a live acknowledgement | NEEDS_HUMAN | `contradiction_voicemail_greeting_vs_acknowledged` |
| 4 | `contact_type` is `wrong_number` | NEEDS_HUMAN | `wrong_number_number_retired_for_event` |
| 5 | `contact_type` is `refused` | NEEDS_HUMAN | `refused_no_redial` |
| 6 | `contact_type` is `language_barrier` | NEEDS_HUMAN | `language_barrier_bilingual_callback_no_redial` |
| 7 | `needs_assistance` is `medical_question` | NEEDS_HUMAN | `medical_question_priority_review` |
| 8 | live person, acknowledged, confidence fails | NEEDS_HUMAN | `confidence_below_gate` |
| 9 | live person, acknowledged, confidence passes, judges disagree | NEEDS_HUMAN | `judge_disagreement_ladder_clock_still_running` |
| 10 | live person, acknowledged, confidence passes, judges agree | **CONFIRMED** | `live_human_acknowledged_with_transcript_evidence` |
| 11 | live person, not acknowledged | UNCONFIRMED | `live_person_did_not_acknowledge` |
| 12 | voicemail | UNCONFIRMED | `voicemail_notice_left_not_confirmation` |
| 13 | no answer or busy | UNCONFIRMED | `{contact_type}_retry` |
| 14 | anything else on a completed call | NEEDS_HUMAN | `contact_type_unknown_on_completed_call` |

### Why the order is what it is

**Rows 1 and 2 come first** because everything below them reads fields that may not exist.
A failed call has no result to interpret, and interpreting it anyway is how a transport
error becomes a business conclusion.

**Row 3 before rows 4 to 10** because a contradiction is worse than either of the things it
contradicts. If the structured result and the transcript disagree about whether a human was
even on the line, no later row's answer is trustworthy.

**Rows 4 to 6 before row 7 and 10** because they are facts about the number that must be
recorded whatever else happened. A wrong number retires the number for the event; putting
that after the confirm path would let a mis-extraction confirm a stranger.

**Row 7 before row 10.** This is the row people are most likely to get wrong. Somebody who
said "yes I heard you" *and then* asked what to do about their equipment has technically
satisfied the confirmation criteria. Closing them out as CONFIRMED would be defensible to a
regulator and wrong for the person, who is now waiting on a callback that nobody scheduled.
So the medical question wins, the contact goes to a person, and the underlying
`contact_type` and `acknowledged` are still recorded so the report counts them under "live
human reached". An operator can then confirm them explicitly, with evidence, and that
confirmation is counted separately in the report.

**Row 8 before row 9** so that "we are not sure the model understood the call" is reported
as a confidence problem rather than as a disagreement between judges. They are different
failures and they get different reason codes.

**Row 12 is the whole product.** Voicemail is a completed call with a delivered message and
it is not contact. Every shortcut in this space collapses row 12 into row 10.

## What the disposition carries

```python
Disposition(
    contact_type, acknowledged, needs_assistance,
    confidence_score, confidence_label,
    judge_a="live_person/yes:structured_result",
    judge_b="live_person/yes:acknowledgement_in_transcript",
    judge_c=None,
    judges_agree=True,
    disposition=CONFIRMED,
    reason_code="live_human_acknowledged_with_transcript_evidence",
    evidence_spans=[...],
    notes_for_human="...",   # redacted
)
```

Both judges' verdicts are stored as strings, not just the combined answer, so a reviewer
can see *which* judge said what without re-running anything. Evidence spans carry the turn
index, the speaker, the offset, and the redacted text.

## What an operator has to do to overturn one

Confirming a `NEEDS_HUMAN` contact requires a named operator and either a pasted transcript
span or a typed reason. Both are recorded on the transition with `actor` set to the
operator. The report then counts that contact under "confirmed by an operator with
evidence", separately from the adjudicator's confirmations, so the two are never silently
pooled.

An operator cannot confirm a contact that was never adjudicated: there is no edge from
`RESERVED` to `CONFIRMED` in the state machine.
