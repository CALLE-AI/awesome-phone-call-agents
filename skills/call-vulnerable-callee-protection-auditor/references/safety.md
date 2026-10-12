# Safety: call-vulnerable-callee-protection-auditor

## Data handling

- The skill never places calls and makes no network requests.
- Findings use a limited ASCII digit-run masker that retains the last two
  characters of matching runs. This is not anonymization: unsupported
  phone formats, names, emails and other private text may remain. Keep real
  transcripts and cards private; review them before sharing.
- Fixtures use fictional numbers in the +1 555-01xx block only.

## Honest capability statement

- This is a lexical marker and timing audit, not a clinical or legal
  assessment of a person's capacity to consent.
- The lexicons are English-only and phrase-bound: "I'm lost", "you're
  going too fast for me", or an unmarked "what's the date again" do not
  fire, so a clean card does not prove the callee followed the call.
- EXPLOITED_UNDER_CONFUSION infers risk from the agent's pressure pattern
  inside a confusion window; it does not verify that a payment or booking
  actually completed.
- Two consecutive clean callee turns close a window; politeness ("okay
  dear", "that's fine") can look clean while confusion persists.
- Every verdict, including VULNERABILITY_RESPECTED, routes to human
  review; the card is not permission to act on the call's result.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; "Findings route to review" names a human check, never
permission to act on the call's result.
