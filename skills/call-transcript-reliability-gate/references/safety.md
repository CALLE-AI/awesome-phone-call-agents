# Safety: call-transcript-reliability-gate

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- A SUSPECT or UNUSABLE verdict is a reason to re-confirm values or seek the
  audio, never proof that the provider hallucinated. A RELIABLE verdict is
  the absence of text-visible symptoms, not a certificate of accuracy.
- Recall-oriented by design: the harm lexicon is narrow but routes to human
  review on any match, because hallucinated harm content and genuine
  emergencies both need a person. Violence terms require a directed object,
  so self-directed hyperbole ("this price will kill me") does not fire, but
  directed phrasing ("this offer will kill you") does and routes to review -
  accepted over-flagging in the safe direction.
- Known blind spots: hallucinations that read as fluent, plausible speech
  produce no text-visible symptom and pass clean; the directed-object guard
  misses oblique phrasings; accented Latin names are deliberately not
  flagged, so short foreign insertions in Latin script are invisible to
  this skill.
- Non-English transcripts: the script-switch signal assumes an
  otherwise-English call; results on non-English calls under-detect rather
  than over-detect.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a do_not_act_on_transcript action is routing advice for a
human, not an instruction to hang up on anyone.
