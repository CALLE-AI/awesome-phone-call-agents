# Safety Pattern: Rehearse Before You Act on a Structured Result

A reusable pattern for phone-call workflows whose next step is *automatic*: a booking written to a
calendar, a "confirmed" flag set, a ticket closed, a refund issued. It answers one question before
that automation runs: **how do you know the report is true?**

This is a design pattern, not a product. It was distilled from the author's rehearsals while
building the `otherend` app in this repository ([`apps/python/otherend`](../apps/python/otherend/)),
which rehearses a task against a scripted counterparty on a line the author owns. The illustrations
below are hypothetical: they describe the shapes of failure a rehearsal is built to surface, not
records of particular calls, and no call data, measurements, or recordings are cited.

## Problem

An outbound call returns a structured result: `task_completed`, a schema filled in, a
`completion_confidence`. Downstream code treats that object as fact. Four things break that
assumption. Each is illustrated with a hypothetical rehearsal:

1. **The agent can only know what it was told.** Suppose a receptionist offers a Saturday
   appointment at a clinic that is closed on Saturdays, and the task text never said so. The caller
   reports the Saturday faithfully with `task_completed: true` and a high confidence label. The
   report is honest; the booking cannot exist.
2. **Confidence measures consistency, not truth.** A high score means the report agrees with the
   transcript. It says nothing about whether the transcript agrees with the world; in the Saturday
   case above it would be high.
3. **The far side is heard through speech recognition.** Suppose the receptionist says "with Doctor
   Chen" and the caller's transcript reads "without Doctor Chen". That reading can go straight into
   `confirmed.provider`, unmarked, and nothing in the result object says a word was misheard.
4. **Ordering instructions are not guaranteed.** Suppose a task says "Disclose immediately that you
   are AI". On one rehearsal the caller might do so in its first turn; on another it might open
   with "Hi, is this Amelia?" and disclose on its next turn. Both transcripts contain the
   disclosure; only one satisfies "immediately".

None of these is a bug in the call. They are properties of any voice agent that plans from a text
task and reports from a transcript. The failure is acting on the report as if it were a fact.

## The pattern

Put a rehearsal between *writing the task* and *letting automation act on its result*, and keep
the same three checks in production.

### 1. Rehearse against a counterparty you control

Before a task reaches a real person, call a line you own that answers the way you decide: a
receptionist that offers an impossible slot, a customer who will not commit, one who insists on a
different time, one who asks "are you an AI?". Because you scripted the other side, you know the
right answer for every field, and you can compare the report to it mechanically. One call per
behavior is enough to learn how the task fails; it is not enough to state a rate, and the write-up
should say `n` out loud.

A rehearsal is worth running again after any edit to the task text or the schema. The text *is*
the program.

### 2. Put world facts in the task, or verify them after

If a fact decides whether the outcome is valid (opening hours, allowed windows, which provider does
what), either state it in the task so the caller can reconcile it, or check the result against
your own record before acting. The `appointment-confirm` entry in this repository does the first:
it lists the only allowed reschedule windows and says "Do not invent other times." A rehearsal
against a scripted customer who picks one of those windows should show the report carrying the
exact ISO window from the task, not a paraphrase of what was spoken; if it does not, the edit
belongs in the task text, not in the customer.

### 3. Treat confidence as a gate on *your* review, not on the truth

- High confidence and a result that matches your own record: act.
- High confidence and a result your record cannot confirm (a slot that does not exist, a provider
  who does not treat that condition): route to a human. This is the case confidence will not catch.
- Low confidence or `unknown`: route to a human. See
  [Fail-closed dispositions](../plugins/zapier-calle/docs/fail-closed-dispositions.md).

### 4. Keep the transcript, and read the far side's turns

Values that come from the other party's speech (a name, a time, a number) passed through speech
recognition. Before acting on one that has consequences, look at the turn it came from. If your
integration can record its own side of the line, an audio-derived transcript is the only source
that can settle "with" versus "without".

### 5. Do not rely on ordering for compliance

If "say X before anything else" is a legal or policy requirement, do not depend on the task text to
enforce the order. Check the first caller turn in the transcript after the call, and prefer a
platform-level preamble where one exists.

## What this pattern does not do

- It does not make a report true. It tells you which reports you have grounds to act on.
- It does not replace consent, allow-listing, or idempotency; it sits after them.
- Rehearsals cost calls and time. A rehearsal line that answers as an LLM has its own slips (a
  wrong weekday, a truncated turn); they belong in the transcript, not in the grade.

## Checklist

- [ ] The task states every fact the caller cannot know but the outcome depends on.
- [ ] The schema has an `unknown` / `needs_human` path for every field an automation acts on.
- [ ] The task was rehearsed against at least one uncooperative counterparty after its last edit.
- [ ] Automation acts only when the report matches a record you hold; otherwise a human does.
- [ ] Consequential values from the far side were checked against the transcript turn they came from.
- [ ] Any "say this first" requirement is verified from the transcript, not assumed.
