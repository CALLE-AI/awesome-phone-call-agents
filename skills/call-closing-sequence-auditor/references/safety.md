# Safety: call-closing-sequence-auditor

## Data handling

- The skill never places calls and makes no network requests.
- The family digit-run masker is available for findings text, but the
  closing card carries booleans and fixed reason codes only - no
  transcript text leaves the analysis. This is not anonymization: keep
  real transcripts and cards private; review them before sharing.
- Fixtures use the fictional number +1 555-0146 only.

## Honest capability statement

- This skill measures closing SEQUENCE SHAPE, not satisfaction. A
  DEFICIENT verdict means "review the ending"; it never convicts.
- A callee hang-up mid-flow truncates the call legitimately. The
  transcript cannot distinguish "agent failed to close" from "person
  was done talking" - the card flags the shape and leaves the judgment
  to a human.
- The farewell lexicon is English-only; farewells in other languages,
  or sign-offs outside the lexicon ("cheers", "that's all"), read as
  absent.
- A "?" can be rhetorical. DANGLING_QUESTION means "check whether the
  person's last question was answered", not "the agent ignored them".
- The 6-turn window may miss an early summary-plus-arrangement in very
  long closings; the window size is a documented choice, not a truth
  claim. A pre-closing summary delivered more than 6 turns before the
  end still counts only if it lands inside the window.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved
example numbers. Any separate host-run live test requires explicit
per-run intent and an authorized, valid E.164 destination. These
helpers neither authorize nor place calls; review_call_ending names a
human decision to make, not permission to re-dial or act on the call.
