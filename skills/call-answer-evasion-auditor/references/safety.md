# Safety: call-answer-evasion-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Question texts in the payload pass through a limited ASCII digit-run
  masker that retains the last two characters of 7+-digit runs. This is
  not anonymization: unsupported phone formats, names, emails and other
  private text may remain. Keep real transcripts and reports private;
  review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- Grading is heuristic and lexical (English-only): an EVASIVE grade is
  evidence of wording, not of intent to deceive, and never of fraud.
- Findings route to human review; they never auto-invalidate a call or
  trigger any action on the callee, the agent, or the record.
- The agent may honestly lack the information; that counts as CLEAR
  only when stated plainly ("I don't have that information").
- Identity questions are never cleared by not-knowing wording: an
  automated caller must disclose what it is.
- Bare repair initiators ("Sorry, what was that?") belong to
  `call-repair-sequence-auditor`; this skill skips them so a mis-heard
  word is never graded as evasion.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved
example numbers. Any separate host-run live test requires explicit
per-run intent and an authorized, valid E.164 destination. These
helpers neither authorize nor place calls.
