# Safety: call-right-party-gatekeeper

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans in the card are masked: any 7+-digit run keeps only its
  last 2 characters, so phone numbers and account IDs do not leak into
  logs built from cards.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- Signal detection is a bounded English lexicon; many legitimate phrasings
  of verification, refusal, or disclosure are not covered. Findings
  under-detect rather than over-detect: UNVERIFIED means "not proven",
  never "wrong party proven".
- WRONG_PARTY and disclosure-ordering findings are reasons for human
  review, not proof of a compliance breach.
- The retry template's safety property is procedural (reveal nothing
  before confirmation), not detection accuracy.

## Test-call policy

Any live verification must target fictional +1 555-01xx numbers or the
organization's published test hotline, per repository policy.
