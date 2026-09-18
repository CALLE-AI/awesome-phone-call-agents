# Safety: call-cross-lingual-emotion-preservation

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans in the card are masked: any 7+-digit run keeps only its
  last 2 characters, so phone numbers and account IDs do not leak into
  logs built from cards.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- The intensity lexicon is English-only and bounded; many urgency and
  worry phrasings are not covered. Non-English source contexts are out of
  scope and under-detect rather than over-detect.
- There is no negation handling: phrases like "no danger" or "nothing
  important" still count their marker words. Treat marginal high-vs-medium
  boundaries with human judgment.
- Drift findings are a reason to re-check the relay wording, not proof of
  harm; AMPLIFIED is flagged symmetrically with FLATTENED because
  over-urgency can also misrepresent the requester.
- Only the relay agent's own turns are scored; the requester's private
  emotional state is inferred from words alone, never asserted as fact.

## Test-call policy

Any live verification must target fictional +1 555-01xx numbers or the
organization's published test hotline, per repository policy.
