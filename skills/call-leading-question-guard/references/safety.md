# Safety: call-leading-question-guard

## Data handling

- The skill never places calls and makes no network requests.
- Findings use a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- The detectors are lexical question-form heuristics, not intent
  detection. A tag question can be friendly; a confident person may
  genuinely agree under a leading form. Findings route to review and
  never auto-invalidate a result.
- `NO_QUESTIONS_ASKED` may be a perfectly legitimate scripted call
  (pure reminder, no elicitation); the card only asks whether the goal
  actually required none.
- Taint requires an affirmation word and an extractable value in the
  same callee turn right after a leading question. Real coercion can
  happen without that co-occurrence, and the co-occurrence can happen
  without coercion - the rule under-detects by design to stay precise.
- Question-form detection is English-only lexical matching; tone,
  prosody, and pressure outside the question sentence are invisible in
  text.
- Known limitation: sentence boundaries directly after "a.m."/"p.m." are
  not split, so a leading question that begins immediately after an
  a.m./p.m.-terminated sentence inside the same agent turn (for example
  "...at 9 a.m. Don't you want a refill?") can merge into the previous
  sentence and be missed. End-anchored and mid-sentence detectors (tag,
  presupposition, coercive) still fire on merged sentences; only a
  sentence-initial negative interrogative in this exact shape can escape.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; reask_neutrally_before_booking names a check to run before
a value drives a booking, not permission to act on the call's result.
