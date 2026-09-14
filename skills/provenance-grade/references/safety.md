# Safety

## This skill never places calls

`provenance-grade` is a post-call analysis and pre-call lint skill. It consumes the
`transcript_turns` of a call that has **already completed** and amends task text
**before** a host dispatches it. It contains no dialing code, no phone numbers, no
retry logic, no scheduling, and no CALL-E API calls of any kind. Explicit-intent,
E.164 validation, quiet hours, cancellation, and dispatch approval are entirely the
host workflow's responsibility — this skill cannot place, modify, or cancel a call
even if misused.

## No network, no persistence

The grader is a pure function over the turns it is handed: zero network in every
code path (the entire test suite runs offline), nothing written to disk, nothing
transmitted. The only inputs are transcript text, integer offsets, and the field
specs the caller supplies.

## No person-level inference

- No emotion detection, stress scoring, deception scoring, or voice biometrics —
  and none are possible by construction, since CALL-E exposes no audio, only
  transcript text and integer turn offsets.
- Grades attach to the **organisation** called, never the individual who answered.
  `recipientId` is an organisation-level identifier; the output schema carries no
  name, phone number, or speaker identifier, and `test/grade.test.ts` asserts this.
- A low grade means *the call did not establish this*, never *this person lied*.

See [ethics.md](ethics.md) for the full boundary statement.

## Data minimisation

Transcript spans are retained only as the minimum quote supporting one graded
field — never the full transcript. The bundled fixtures are entirely synthetic:
invented businesses, invented order numbers, no real phone numbers anywhere in
this skill.

## Decision boundaries

Grades are an **ordering of trust, not a measurement of truth** (they are not yet
validated against outcomes — see [limitations.md](limitations.md)). The consumer
rule is part of the safety contract:

- act automatically only on `verified`;
- keep a human in the loop for `asserted`;
- never auto-act on `assumed` or `unstated`.

Do not use grades as the basis for medical, legal, financial, or emergency
decisions, or for evaluating, disciplining, or profiling any individual. The
pre-call lint only adds elicitation instructions (read-backs, "can you check?",
one corroborating specific); it never adds pressure tactics, repeated calls, or
deception, and it must not be used to script any of those.
