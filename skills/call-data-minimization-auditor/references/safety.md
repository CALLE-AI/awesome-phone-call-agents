# Safety: call-data-minimization-auditor

## Heuristic scope

- This skill is a lexical audit, not a privacy compliance tool. The goal
  file is the sole ground truth for scope: a category the goal omits may
  still be lawful to collect under a separate lawful basis, and a goal
  that names a category does not make collecting it lawful.
- High-sensitivity tags are advisory, not a legal determination.
  OVERCOLLECTION_DETECTED routes the call to human review; it never
  authorizes blocking, deleting, or acting on the call's result.

## Review routing

- Every finding (out-of-scope, redundant, echo) names a sentence and a
  turn for a reviewer to check against the record. Findings are evidence
  for review, not verdicts about the agent's or the organization's
  legality.

## Data handling

- The skill never places calls and makes no network requests.
- Sentences carried into findings pass through a limited ASCII digit-run
  masker that retains the last two characters of 7+-digit runs. This is
  not anonymization: unsupported phone formats, names, emails and other
  private text may remain. Keep real transcripts and findings private;
  review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block and fictional
  card/SSN-shaped digit groups.

## Volunteering is never flagged

- Callee turns are never scanned for requests. A caller who volunteers
  their SSN unprompted produces no finding against anyone; only the
  AGENT's asks are audited.
- `references/example-goal.txt` doubles as the craft goal example: an
  appointment-intake goal whose required fields are exactly the caller's
  full name and callback phone number, and nothing else.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved
example numbers. Any separate host-run live test requires explicit
per-run intent and an authorized, valid E.164 destination. These helpers
neither authorize nor place calls.
