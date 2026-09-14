# Ethics boundary

This skill grades **behaviour, not people.** The boundary is structural, not
aspirational — it is enforced by what the code can and cannot see, and tested
(`test/grade.test.ts` asserts the output schema carries no person-identifying field).

## No inference about the person

- No emotion detection. No stress scoring. No deception scoring. No voice
  biometrics. None of these are attempted, and none are possible here by
  construction: CALL-E exposes no audio — only transcript text and integer turn
  offsets. The signals measure what was *said and when*, never how it *sounded*.
- The hedging and deferral lexicons detect **speech acts** ("let me get back to
  you"), not personality traits. A person who hedges is being epistemically honest;
  the grade records that honesty, it does not punish it.

## Grades attach to organisations

- Grades are stored against the **organisation** called, never the individual who
  answered. `recipientId` in the output contract is an organisation-level
  identifier. No field in the output can identify the person — no name, no direct
  phone line, no speaker identifier. (`concord` in this repository sets the
  precedent for organisation-level records; this skill follows it.)

## What a low grade means

> A low grade means *the call did not establish this*, never *this person lied*.

That sentence is the whole interpretive contract. `assumed` is a statement about
the **call** — the questions asked, the evidence elicited — at least as much as
about the answer. The pre-call lint exists because a bad grade is often the
caller's fault: if you never asked for a read-back, you cannot complain the value
was never confirmed.

## Data minimisation

- Transcript spans are retained only as the minimum quote supporting one field —
  never the full transcript, never turns unrelated to a graded field.
- The grader is a pure function over the turns it is handed. It stores nothing,
  transmits nothing, and calls no network in any code path (enforced in tests:
  the entire suite runs offline).
