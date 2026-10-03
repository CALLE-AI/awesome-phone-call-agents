---
name: conversation-clarify
description: Detect when a written exchange has failed - a reply that agrees without saying which option, or commits without saying when - and settle it with one bounded, disclosed CALL-E phone call, returning the answer bound to the recipient's own words or refusing to answer at all. Use when another email round-trip is unlikely to resolve an ambiguity that both parties have stopped noticing.
license: MIT
---

# Conversation Clarify

Use this skill when a written exchange contains a question that is still open, and
neither party has noticed.

Email fails quietly. Its characteristic failure is not silence, which is obvious, but
**false resolution**: a reply that is grammatically responsive and semantically empty.
Both sides believe the matter is settled. It is not.

> **You:** Does Monday or Tuesday work for the kickoff? Stephen can only join Tuesday.
> **Them:** Yeah, I'll be there.

Which day? A further email costs two days and may repeat the failure. Thirty seconds of
voice ends it. This skill decides when that trade is worth making, composes the one
question the call must ask, and — this is the part that matters — refuses to write
anything down unless the call actually established an answer.

Conversation analysts call this *repair*: the machinery by which speakers detect and fix
trouble in speaking, hearing or understanding. What is unusual here is that the trouble
happened in writing and the repair happens in voice.

*This is not a skill for calling people who cannot be emailed.* Here the recipient
obviously has email: you are mid-thread with them. That is precisely the problem. Use
the phone when email is **insufficient**, not when it is impossible.

## When to use

- A reply agreed to an either/or question without naming either option.
- A reply committed to an action without naming a date, quantity, or deliverable.
- The cost of continuing to be wrong exceeds the cost and intrusion of one short call.
- The recipient's number appears in the thread itself, and they are someone you are
  already corresponding with.

## When not to use

- **Anything relationship-sensitive.** A rate negotiation, a complaint, a first contact,
  bad news, or anything where the recipient would expect a person. A disclosed AI caller
  is fine for logistics and wrong for these.
- **When nobody asked and nothing is ambiguous.** A thread that reads cleanly needs no
  call. Silence is the correct output far more often than a finding.
- **To chase someone who has not replied.** That is not repair; that is pursuit, and it
  needs a different justification.
- **When the number had to be looked up.** If it is not in the thread and the user did
  not type it, there is no call to make.
- **Medical, legal, financial, or emergency substance.** Route those to a person.

## The two patterns this detects

**A. Unclear choice.** The ask offered two or more options; the reply is affirmative and
names none of them.

**B. Commitment without specifics.** The ask requested something; the reply agrees but
contains no date, time, or quantity. Vague-time words — *soon, shortly, ASAP, end of day*
— raise confidence rather than lower it.

Both require an affirmative reply. *"I'll check and revert"* is not a failure of the
channel; it is a person telling you they will get back to you.

Further patterns worth detecting, documented here so they can be added deliberately
rather than discovered accidentally, are described in
[references/patterns.md](references/patterns.md): unacknowledged conditions,
contradictions across a thread, and pre-commitment verification.

### Rules first, a model only to widen recall

Detect with rules: deterministic, offline, no key, and readable by whoever needs to know
exactly what fires. A model pass on top catches phrasings the rules were never written for
— *"should we ship to everyone at once, or stagger it over the week?"* answered with
*"whatever you think is best"* — but it must be constrained in code, not in the prompt:

- **Require verbatim quotes.** Every model finding must quote a question and a reply that
  appear in the thread; check them against the actual messages and discard a paraphrase.
  This is the guard that stops a confident hallucination becoming a proposal to telephone
  a real person.
- **Check attribution.** The ask must come from the user, the non-answer from the other
  party, in that order. A model that misreads who said what is proposing the wrong call.
- **Never let it reach a destination or a dial.** It produces findings, nothing else.
- **Rules win where both fire**, and a model finding is never marked high confidence.
- **Degrade loudly.** If the provider is unreachable, fall back to rules and say so, rather
  than silently detecting less.

## The call contract

Give the call **numbered steps, not a paragraph.** Observed across four live calls: given
prose, the caller reordered the sequence — disclosing the whole purpose before checking who
had answered — and on one call dropped the read-back entirely. Numbered, both held.

1. **Check who answered.** If it is not the intended recipient, go straight to the ending
   rule. Ask this before disclosing anything.
2. **Disclose** that it is an AI assistant, on whose behalf, and about which thread.
3. **State the situation** — what was asked, what came back, and why that did not settle it.
4. **Ask one question.** The one the detector identified. Nothing else.
5. **Read the answer back and get confirmation.** Say explicitly that this step cannot be
   skipped and the call must not end before they confirm. It is the recipient's only chance
   to correct a mishearing before it is written into their thread.
6. **Thank them and end.**

Throughout: greet once, stay under a minute, discuss nothing else, and never agree, commit,
negotiate, or answer on the user's behalf. **Ending rule** — on voicemail, an automated
system, or the wrong person, end politely without leaving any of the details.

A caller that can be drawn into a second topic is a caller that can commit the user to
something they never approved.

## The evidence gate

A call produces testimony, not fact. Before a single word is written back into the
thread, all of these must hold:

| Check | Why |
| --- | --- |
| `status == "completed"` | The call ran to a terminal state. |
| `task_completed == true` | CALL-E judged the task reached a clear end. |
| `structured_result` is not null | A schema-valid result was extracted at all. |
| `answered_by == "human"` | Voicemail and IVR are not answers. |
| `resolved == "yes"` | The question was actually settled. |
| a non-empty answer | Something was said. |
| a quote that appears in the transcript | Checked against what the recipient actually said, so "verbatim" means something. |
| the answer is one of the options offered | Whole-word, and rejected if negated. Catches an extraction that invented a value. |

Any failure means **nothing is drafted** and the user is told, in plain language, which
checks failed. An unresolved thread left untouched is a correct outcome, not an error.

**`completion_confidence` is not consulted.** On an observed call that never rang, CALL-E
returned `completion_confidence: {"score": 0.85, "label": "high"}` alongside
`task_completed: false`. Confidence expresses certainty in the judgement, not success of
the task. Treating it as evidence would have drafted a confirmation from a phone that
never rang.

## Workflow

1. Read the thread, expanding anything collapsed first. A thread read in fragments risks
   attributing a question to the wrong person. Attribute every message to a sender; refuse
   if attribution is uncertain.
2. Detect. Emit at most one finding per reply — one call settles one question. If detection
   runs automatically as threads are opened, run the deterministic rules only: a model pass
   on every thread opened costs money and latency for threads that are almost always fine.
   Reserve the model for a check a person asked for.
3. Take the destination **from the thread or from the user**. Never look one up. Require
   strict ASCII E.164; surface a number without a country code as unusable rather than
   completing it with a guess.
4. Show the user the exact question, the masked destination, and the full task text
   before asking for approval.
5. Require explicit intent for that specific proposal, on a control that names the
   destination. A configuration setting is not intent. Issue the dial endpoint a one-time
   token with the proposal so a call cannot be started without first fetching what it
   would be.
6. Place one call with an idempotency key derived from the thread content, the finding,
   the destination, and a nonce for the running process. Advance the attempt counter only
   after the previous attempt reaches a terminal state, so a retry is possible but a
   double-click is not. If the provider answers with a call it already holds rather than
   placing a new one, refuse it instead of polling it — see
   [references/safety.md](references/safety.md).
7. Poll to terminal. Do not trust an unsigned webhook for a side effect. Treat the
   submission as **failed** only when the provider answered and rejected it. A
   timeout, a connection reset or a server error leaves the outcome **unknown**:
   the call may already have been placed. Hold the key, require reconciliation,
   and do not issue a new one.
8. Apply the gate. Draft, or explain the abstention.

## Result schema

Keep `required` to fields that can always be filled. CALL-E returns `structured_result:
null` for the **whole** call if the schema cannot be satisfied, so a required free-text
field can destroy an otherwise usable verdict. Express absence with an empty string:
union types such as `{"type": ["string", "null"]}` are rejected.

```json
{
  "type": "object",
  "required": ["resolved", "answered_by"],
  "properties": {
    "resolved":       { "type": "string", "enum": ["yes", "no", "unknown"] },
    "answered_by":    { "type": "string", "enum": ["human", "ivr", "voicemail", "unknown"] },
    "chosen_option":  { "type": "string" },
    "evidence_quote": { "type": "string" }
  },
  "additionalProperties": false
}
```

`answered_by` must be requested explicitly. The Calls API has no built-in answering
machine detection, and its `failure_code` is not a published enum, so no-answer and
decline cannot be distinguished. Treat both as unresolved.

## Side effects and cancellation

Placing a call rings a real person's phone. That cannot be undone: CALL-E exposes no
cancellation operation, and a call already in flight runs to completion. Say so plainly
rather than implying a stop button exists.

Nothing is ever sent on the user's behalf. The draft is handed back for review and the
user sends it themselves.

## References

- [references/safety.md](references/safety.md) — consent, disclosure, number handling,
  boundaries, and honest failure modes.
- [references/examples.md](references/examples.md) — worked examples, including the
  cases that must **not** produce a finding.
- [references/patterns.md](references/patterns.md) — further failure patterns, for
  deliberate extension.
