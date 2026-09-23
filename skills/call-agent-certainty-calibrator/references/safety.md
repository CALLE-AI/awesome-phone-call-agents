# Safety: call-agent-certainty-calibrator

## Data handling

- The skill never places calls and makes no network requests.
- Findings use a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- OVER-ASSERTION is defined against the goal text: a value can be true and
  still flag, because the goal forgot it. The remedy is verification
  against the record, never deletion of the value.
- OVER-HEDGING requires hedge words without source attribution in the same
  sentence; subtle uncertainty (tone, prosody) is invisible in text. A
  hedged fact that the callee understood fine still counts as hedged -
  the finding is about authority, not comprehension.
- Value detection is amount/date/time lexical only; policy claims,
  promises, and free-text assertions are out of scope. English-only.
- Without extractable goal facts the card says so and refuses to grade.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; verify_unsourced_values names a check to run against the
record, not permission to act on the call's result.
