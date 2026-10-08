# Safety: call-human-escalation-request-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Before any excerpt or grade is stored, all digit runs of 7 or more digits
  are masked by a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported phone
  formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- No PII is retained by the skill itself: it writes one card to stdout (or
  the `--out` path) and holds nothing between runs.
- Fixtures use fictional numbers in the +1 555-01xx block only.

## Verdicts are routing advice

- `HONORED` means the agent acknowledged and committed on the transcript.
  It does NOT prove a transfer happened or that a human ever joined the
  call. Treat HONORED as healthy transcript behavior, not transfer proof.
- `DEFLECTED` and `IGNORED` route to human review of the escalation path:
  the agent stalled or never engaged with the demand. They are process
  findings, not findings about intent.
- `FALSE_HUMAN_CLAIM` is the severe flag: the agent text matched the
  false-human lexicon in the response window. It is a signal to escalate to
  human review immediately - it is NOT a legal determination of deceit, and
  lexicon matches can be wrong (quoted speech, role-play, unusual phrasing).
- Every card repeats this in its `disclaimer` field: findings are flags for
  review, never a determination of deceit.

## Scope limits

- English-only lexicons; non-English demands silently produce
  `NO_ESCALATION_REQUESTED`. Absence of a request is not proof the callee
  never asked.
- The skill reads transcripts only. It cannot observe transfers, holds, or
  join events outside the text, and its `analyze` output neither authorizes
  nor places any call.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; an HONORED grade names a transcript outcome to review, not
permission to act on the call's result.
