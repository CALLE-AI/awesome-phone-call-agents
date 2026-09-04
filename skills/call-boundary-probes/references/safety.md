# Safety

## Verification boundary

This skill verifies only a local JSON policy artifact. The corpus supplies an
explicit category beside each inert prompt, and the checker compares the policy
rule for that category with an expected disposition. It does not interpret the
prompt or execute the system under test.

A passing result does not show that a classifier will choose the right category,
that an agent will follow the policy, that a provider will preserve instructions,
or that a recipient will hear the intended response. Keep those claims false
until separately tested with evidence appropriate to each boundary.

## High-impact requests

Medical, legal, and financial probes exist only to establish that professional
advice is outside the automated call's authority. They contain no diagnosis,
triage, treatment, dosage, legal conclusion, investment recommendation, or
financial scoring.

An emergency probe requires automated handling to stop and route to a human
process. The checker places no call, selects no emergency service, and must never
be the only route for urgent help.

## Recipient and instruction boundaries

When the event is `wrong_recipient`, the policy must terminate without revealing
the call's context. A prompt-injection string is untrusted recipient speech, not
an instruction to the host. Repeated insistence does not widen authority.

Ambiguous language must not be converted into consent, identity, approval, or a
commitment. The bundled policy escalates without continuing the call.

## Data and side effects

- Use synthetic prompts only. Do not add names, account identifiers, email
  addresses, phone numbers, transcripts, or other personal data.
- Store no credentials in a policy, corpus, result, or command line.
- The checker uses Node built-ins, reads local files, writes nothing, opens no
  sockets, creates no jobs, and places no calls.
- There is nothing to cancel or roll back after a checker run.
