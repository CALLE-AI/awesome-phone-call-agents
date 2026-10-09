# Safety: call-temporal-anchor-auditor

## Data handling

- Masking comes first: every turn text passes through a limited ASCII
  digit-run masker (7+ digits, separators included, last two characters
  kept) before any analysis. Consequence for this skill: fully numeric
  dates with 7+ total digits - "10/14/2026" - are masked into invisibility
  and never reach the collector. Prefer month-name dates ("October 14") in
  goals and check such dates by hand.
- The masker is not anonymization: short numbers, names, emails and other
  private text may remain. Keep real transcripts and cards private; review
  them before sharing.
- The skill never places calls and makes no network requests; runs are
  offline and deterministic, and no input or output is retained beyond the
  process.
- Fixtures use fictional numbers in the +1555-01xx block; the shipped
  fixtures use the reserved +14155550198 line only.

## Honest capability statement

- Every verdict is advisory. An AMBIGUOUS flag, a conflict, or a
  RELATIVE_ONLY_COMMITMENT is not proof the callee misunderstood, misheard,
  or will miss the appointment; it is a reason to verify the commitment
  against the record.
- Relative expressions without `--called-at` grade
  `unresolvable_without_call_time` and weekday-date pair checks are skipped
  with an explicit note; the card says so rather than guessing.
- Conflicts are lexical: clock conflict rule (c) keys on the 12-hour
  number, so a legitimate a.m./p.m. pair can flag. Read the turns before
  acting on an INTERNAL_DATE_CONFLICT.
- The skill grades the agent's wording only; it has no access to audio,
  intent, or the callee's understanding, and it is not a scheduler - craft
  mode emits goal text, not bookings, and never authorizes acting on a
  call's outcome.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls.
