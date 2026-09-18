# Safety: call-verbal-irony-detector

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans in the card are masked: any 7+-digit run keeps only its
  last 2 characters, so phone numbers and account IDs do not leak into
  logs built from cards.
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

Any live verification must target fictional +1 555-01xx numbers or the
organization's published test hotline, per repository policy.
