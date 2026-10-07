# Safety: call-post-summary-faithfulness-auditor

## Masking before analysis

- Any 7+-digit run (separators included) is masked in the post_summary
  and in every transcript turn before any claim work begins, keeping only
  the last two characters. A phone number can therefore never anchor a
  claim and never appear in a card.
- This is a heuristic masker, not anonymization: names, emails, and
  short numeric fragments are out of its scope. Keep real transcripts and
  cards private; review them before sharing.

## What a verdict is - and is not

- Verdicts are routing advice for humans and workflow gates. They are
  never proof that the agent lied or intended to deceive.
- UNSUPPORTED means the claim value was not found verbatim in any
  transcript turn. The claim may still be true - wording, ASR rendering,
  or a value the transcript under-captured can all produce a miss. The
  remedy is verification against the call record, never silent deletion
  or silent acceptance.
- CONTRADICTED is deliberately narrow: it fires only when an outcome
  claim's polarity conflicts with callee speech in the final third of the
  call under a fixed lexical rule. It is not a general consistency check
  and not a semantic contradiction detector.
- FAITHFUL means every checkable claim anchored lexically. It is not a
  certificate that the summary is complete or that the call went well;
  the `coverage_gaps` field exists precisely because a faithful summary
  can still omit an outcome the transcript contains.

## Data handling

- The skill never places calls, makes no network requests, and stores
  nothing: it reads one JSON file, prints one card, and exits.
- Fixtures use fictional numbers in the +1 555-01xx block only.

## Human review

- Anything consequential - a writeback, a refund, a booking that charges
  money - should be gated on human review whenever the verdict is not
  FAITHFUL, and spot-checked even when it is. The card names checks to
  run against the call record; it does not authorize anyone to act on
  the call's result.
