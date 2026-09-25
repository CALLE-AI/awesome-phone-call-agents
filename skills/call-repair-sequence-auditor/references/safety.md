# Safety: call-repair-sequence-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Repair spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- Repair detection is lexical: prosody, pauses, and overlap - the cues a
  conversation analyst would also use - are invisible in transcripts, so
  counts under-report rather than over-report. Discourse-marker false
  positives ("I see what you mean") are guarded with question-mark and
  lookbehind rules, not eliminated.
- The human baseline (about one repair per 1.4 minutes) compares different
  corpora and is illustrative only. This card reports per-call counts, not
  a calibrated rate, because CALL-E transcripts carry no reliable offsets.
- An ADDRESSED classification means the agent's next turn visibly
  re-delivered; it does not prove the callee understood. An IGNORED repair
  is a coaching signal, not proof the call failed.
- Non-English transcripts: the lexicons are English-only; results on other
  languages under-detect rather than over-detect (fail toward LOW).

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a redial_with_simplified_goal action is a suggested goal
text for a separately approved plan_call, not permission to call again.
