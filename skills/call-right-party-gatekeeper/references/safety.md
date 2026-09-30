# Safety: call-right-party-gatekeeper

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
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

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a suggested follow-up is not permission to call again.
