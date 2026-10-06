# Safety: call-total-cost-disclosure-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Findings use a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- This is a heuristic presence-and-timing audit, not price verification: a
  total can be stated pre-consent and still be wrong or incomplete.
- DRIP_PRICING_DETECTED and every other verdict route to review; the card
  is not a legal ruling and does not measure compliance with any statute
  or regulation by itself.
- The digits-and-"dollars" amount lexicon misses number words and non-USD
  currencies in v1; a call can disclose a real total and still flag
  COMMITMENT_WITHOUT_AMOUNT.
- Consent is decided lexically from the callee's first sentence with a
  negation guard; hesitations, questions, and indirect assent are
  invisible to it.
- English-only lexicons; other languages yield NO_MONETARY_COMMITMENT or
  false negatives, not errors.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; "Findings route to review" names a human check, never
permission to act on the call's result.
