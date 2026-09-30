# Safety: call-semantic-barge-in-analyzer

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
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

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a suggested follow-up is not permission to call again.
