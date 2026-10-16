# Safety: call-apology-effectiveness-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Findings use a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block.

## Honest capability statement

- The grievance lexicon is a surface marker, not proof of genuine
  distress; the component lexicons are surface markers, not proof of
  sincerity. An agent can produce a text-perfect apology with no
  feeling behind it, and a sincere but differently-worded apology can
  score zero components.
- Only the FIRST grievance's response window is graded. Later grievances
  are counted in `grievances_total` but their responses are not
  separately graded; a call that recovered well once and failed twice
  can still read EFFECTIVE.
- A NON_APOLOGY verdict is not an instruction to apologize. Sometimes the
  right posture is no apology at all: the agent cannot own fault it does
  not have, and the grievance may be misdirected. The card routes to
  human review, never to automatic action.
- Component detection is English-only lexical matching; tone, prosody,
  and cultural apology norms are invisible in text.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; escalate_to_human names a routing suggestion for a human
reviewer, not an automated escalation.
