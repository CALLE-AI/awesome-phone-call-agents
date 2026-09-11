# Safety and Curation Rules

This skill places real outbound phone calls and writes a shared memory. Every
rule below is mandatory.

## Consent and contact

- Call only a patient who has **consented** to adherence check-in calls. A record
  with `consent=false` is never called, and a self-supplied number is never
  treated as consent on its own — consent must be explicit (an operator flag for
  ad-hoc calls, or a per-patient consent record in a roster).
- A live dial must be strict **E.164** (for example `+12025550100`) AND match a
  **non-empty** authorized-destination allowlist; an empty allowlist fails closed.
- Do not place calls during the caller's **quiet hours**
  (`CORTEX_QUIET_HOURS`, region-local). Only an interactive operator may
  override, and only for a live human-in-the-loop test.
- No hidden or recurring schedules. A call happens only when an operator runs the
  workflow. No duplicate jobs: the same caller is not dialed twice within the
  idempotency window.

## Medical boundaries (hard limits)

- This is a check-in, **not** medical care. Do **not** diagnose, do **not**
  recommend a medicine, dose, or change, and do **not** give medical advice.
- Only listen, acknowledge, and note answers.
- If the caller reports anything serious or asks for advice, say a pharmacist or
  doctor will follow up, and flag it for a human. Do not attempt to handle it.
- Keep the call short and warm. Confirm it is an okay time to talk; if not,
  apologize and end.

## Privacy

- Personal detail (name, summary, callback context) lives **only** in that
  caller's private sub-brain. It is never copied into the shared master brain.
- Master-brain facts and signals are **general and anonymized** (for example
  "some patients on Drug X report nausea"), never attributed to a person.
- Corroboration sources are stored as **keyed-HMAC ids** of phone numbers (not
  bare hashes — a phone number is a small, enumerable keyspace), so a shared fact
  cannot be traced back to an individual without the secret key.
- **Right to forget:** deleting a caller erases their sub-brain **and their
  call-log rows** (raw number, summary, transcript) — a complete removal of their
  personal data. The anonymized master brain is unaffected (no attributable PII).
- **Mask phone numbers** in every user-facing summary.

## Curation gate (anti-poisoning)

- A learned fact stays a **candidate** until **at least two distinct callers**
  independently report it. The same caller repeating themselves does not count.
- Only a corroborated fact becomes **canonical** and eligible to influence future
  calls.
- The agent starts **proactively asking** about a pattern only after it is either
  auto-approved (enough distinct callers) or **explicitly approved by an admin**.
  An admin can require manual approval for every change and can revoke any
  approved pattern.

## Credentials

- The CALL-E CLI holds its own OAuth token; the workflow does not read or store
  it.
- Any model API key is read from the environment only and is never committed or
  logged.
