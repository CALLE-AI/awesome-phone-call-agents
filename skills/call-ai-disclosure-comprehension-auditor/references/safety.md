# Safety: call-ai-disclosure-comprehension-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- An UNDISCLOSED or PARTIAL verdict describes the transcript, not the
  callee's mind: people understand disclosures without acknowledging and
  misunderstand ones they acknowledged. The card routes to re-checking,
  never to assumptions.
- The comprehension-check window is deliberately strict: a check after
  business content does not count, which can under-credit agents whose
  disclosure turn also contained a date. Fail direction: more flags, not
  fewer.
- The disclosure lexicon is English-only and phrase-based; paraphrases
  outside the lexicon under-detect (fail toward UNDISCLOSED, the safer
  direction).
- Regulatory references (EU AI Act Article 50, applicable from 2026-08-02)
  motivate the design; this skill is not legal advice and certifies
  compliance with nothing.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a redial_with_disclosure_goal action is a suggested goal
text for a separately approved plan_call, not permission to call again.
