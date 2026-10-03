# Safety — vouch

How maintainers decide whether to merge.

Vouch is consent-scoped employment verification. **No consent artifact, no
dial.** There is no override in the UI for missing, revoked, or expired
consent. Default mode is fixture replay. Live calling requires `CALLE_LIVE=1`,
a real API key, and an explicit non-555 destination.

Seed data uses masked fictional numbers only (`+1 707 ••• ••40`). Region and
locale are not inferred from a phone number.

The header always shows remaining budget against a project cap of 20. The kill
switch is on every screen.

## Disclosure

- Compiled task identifies as an automated verification assistant acting for
  the requesting org.
- The candidate's written authorization date is in the task. The agent asks
  the speaker's name, role, and authority before recording answers.

## Authorization

- Consent gate runs in code before enqueue. Confirm is disabled when the gate
  fails or kill is on.
- Scope compiler: requested ∩ consent fields, minus jurisdiction blocks
  (California SB 1162 strips `salary_history`). A field absent from the
  permitted set cannot reach the task string.
- Idempotency key is derived from the authorization, not the attempt.
- Employment and education only. Criminal and credit stay out.

## When the model is wrong

- Unsupported fields strike through on the run report and on CallReel.
- Third-party-only / policy / wrong-department are distinct dispositions, not
  a collapsed "fail."
- Gatekeeper fixture records `refusal_reason: third_party_only` and ends the
  call. No persuasion.

## Out of scope

- No salary history in California, even if the requester asked and the consent
  form included it.
- No criminal, credit, medical, disability, or performance questions.
- No hidden recurring schedules.
- English-only task text.
