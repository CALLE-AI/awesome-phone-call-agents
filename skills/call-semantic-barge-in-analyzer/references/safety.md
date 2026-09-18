# Safety: call-semantic-barge-in-analyzer

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans in the card are masked: any 7+-digit run keeps only its
  last 2 characters, so phone numbers and account IDs do not leak into
  logs built from cards.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- Classification is a bounded English lexicon; many backchannel and
  interruption phrasings are not covered. DISENGAGED in particular is a
  weak proxy post-hoc (short answers can be situational), and every
  profile carries pacing advice only - never a judgment about the person.
- Interruptions are inferred from turn text, not overlapping-speech
  timing; a true barge-in that ASR ordered politely will read as a normal
  turn.
- The pacing template's safety property is procedural (short turns,
  yield on hold language, restate before closing), not detection accuracy.

## Test-call policy

Any live verification must target fictional +1 555-01xx numbers or the
organization's published test hotline, per repository policy.
