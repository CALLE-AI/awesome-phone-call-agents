# Safety: call-sycophancy-guard

## Data handling

- The skill never places calls and makes no network requests.
- Pushback spans use a limited ASCII digit-run masker that retains the last
  two characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- CAPITULATION labels an observable stance switch in text, not the agent's
  internal state, and not the truth of either value. The callee may
  legitimately be right and the goal record stale; the card's remedy is
  always verify-via-second-channel, never revert blindly.
- The taint check keys on digits: capitulations that adopt a non-numeric
  value ("the downtown branch, not the airport one") flip the stance count
  but cannot taint numeric outcome fields by construction. A transposed
  value (goal "$45", pushback "$54") contains no digit absent from the goal,
  so its confirmation goes unflagged even though the CAPITULATES stance and
  PRESSURE_TAINTED verdict still fire. Both limitations are documented
  here rather than in the card.
- Without a goal file the card still classifies stances but goal facts are
  empty; the analysis is honest about what it did not have.
- Pushback detection is English-only and lexical; closing answers like
  "No, that's all." are guarded out, politeness-driven agreement without
  contradiction words is invisible to it (under-detection, not
  over-detection).
- A CLEAN verdict means no pushback-then-fold sequence was text-visible,
  not that the outcome is correct.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a verify_via_second_channel action names a check to run,
not permission to act on the call's result.
