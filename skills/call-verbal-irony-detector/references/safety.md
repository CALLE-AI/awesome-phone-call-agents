# Safety: call-verbal-irony-detector

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- Text-only irony detection is inherently ambiguous; HIGH/MEDIUM findings
  are a reason to re-verify intent, never proof of the callee's feelings.
- The recommended de-escalation goal instructs the agent to confirm literal
  intent before acting - the safety net is the confirmation question, not
  the detector.
- Non-English transcripts: the lexicon is English-only; results on other
  languages under-detect rather than over-detect (fail toward "continue").

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a suggested follow-up is not permission to call again.
