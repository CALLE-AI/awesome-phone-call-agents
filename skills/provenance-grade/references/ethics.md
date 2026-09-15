# Ethics boundary

This skill is intended to grade **transcript evidence, not people**. The schema
omits dedicated person-profile fields, but that is not structural anonymization:
caller-supplied IDs, values and exact answer spans may contain identifying data.
The caller is responsible for appropriate use, input minimization and redaction
of any display/export copies; the grader leaves evidence unchanged.

## No inference about the person

- No emotion detection. No stress scoring. No deception scoring. No voice
  biometrics. None of these are attempted, and none are possible here by
  construction: CALL-E exposes no audio — only transcript text and integer turn
  offsets. The signals measure what was *said and when*, never how it *sounded*.
- The hedging and deferral lexicons detect **speech acts** ("let me get back to
  you"), not personality traits. A person who hedges is being epistemically honest;
  the grade records that honesty, it does not punish it.

## Grades attach to organisations

- Hosts should store grades against the **organisation** called, not the individual
  who answered. Supply an organisation-level `recipientId`; the pure grader does
  not validate that meaning and does not remove personal data from free-text fields.

## What a low grade means

> A low grade means *the call did not establish this*, never *this person lied*.

That sentence is the whole interpretive contract. `assumed` is a statement about
the **call** — the questions asked, the evidence elicited — at least as much as
about the answer. The pre-call lint exists because a bad grade is often the
caller's fault: if you never asked for a read-back, you cannot complain the value
was never confirmed.

## Data minimisation

- Output spans contain the selected answer text for a graded field and may include
  incidental personal information. Hosts must minimize retention and sanitize
  copies before display/export; selection is not automatic privacy filtering.
- The grader is a pure function over the turns it is handed. It stores nothing,
  transmits nothing, and calls no network in any code path (enforced in tests:
  the entire suite runs offline).
