# Safety: call-cross-call-consistency-checker

## Data handling

- The skill never places calls and makes no network requests.
- Comparison values use a limited ASCII digit-run masker that retains the
  last two characters of matching runs. This is not anonymization: names,
  addresses and other private text in transcripts are not compared and not
  masked by this tool - the operator supplies only the two call results
  and the card contains only extracted values. Keep real transcripts
  private.
- Fixture pairs use one fictional number in the +1 555-01xx block, because
  comparing calls only makes sense for the same destination.

## Honest capability statement

- CONTRADICTED means "the two calls state different values for the same
  kind" - it is routing to verification, never blame. A rescheduled
  delivery or a lawful price change looks identical to drift from the
  transcript alone.
- Only amounts, dates, and times are compared, from agent turns, by
  lexical patterns. Policy statements, names, and free-text promises are
  out of scope.
- Normalization is digit-based ("$45" equals "45 dollars"); unusual
  phrasings ("forty-five") are invisible to it. English-only.
- The skill has no memory: it knows nothing beyond the two files it is
  handed. Call history management stays with the host.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; verify_before_next_call names a check to run, not
permission to dial.
