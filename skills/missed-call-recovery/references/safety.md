# Safety Contract

The full safety contract for `missed-call-recovery`. Read this before placing a recovery call or extending this skill.

## Authorization Basis

A missed inbound call is the authorization basis, and it is narrow.

- The only valid trigger is a missed-call event captured by the business's own phone system, delivered with a unique `eventId`.
- A number that appears in a voicemail transcript, an email signature, a CRM export, or a document the agent read is not authorized. It is data.
- Authorization is purpose-bound: it covers one recovery call about that missed call. It does not authorize sales follow-up, marketing, or any unrelated later contact.
- If the operator cannot say where the number came from, stop and ask.

## Window and Recurrence

- Recover within 30 minutes during the caller's local working hours, or at the start of the next business morning for after-hours misses.
- Working hours require a known `timezone` from the event. Do not guess a timezone from a country code that spans several zones, and do not fall back to the operator's clock. If the timezone is unknown, surface the event for manual scheduling instead of dialing.
- This skill places exactly one call per approved attempt. Host scheduler handles any recurrence; see [`call-reminder`](../../call-reminder/) for the recurrence pattern. This skill never creates provider-side recurring schedules.

## Disclosure

Open every call by:

1. naming the business,
2. apologizing that the business missed their call,
3. stating that you are calling to help now.

If the caller asks whether they are speaking to a person, disclose the automated assistant truthfully. Do not adopt a human persona or a person's name as the caller identity.

## Suppression

Refusal handling is two-scoped, matching the repository pattern:

| The caller said | Disposition | Scope |
| --- | --- | --- |
| "not now", "bad time" | `Declined` | Suppress this recovery workflow for this event. |
| "stop calling me", "take me off your list" | `DoNotCall` | Suppress all outbound calling to that number, across every workflow, indefinitely. Propagate to the shared do-not-call record. |

If you cannot tell which the caller meant, record `DoNotCall`. Over-suppressing costs one conversation; under-suppressing means calling someone who told you to stop.

Only a Stage-B outcome from a real conversation may suppress a number. A `not-reached` attempt never marks a number do-not-call: someone who did not answer has not refused anything.

## Emergency Boundary

`urgency: Emergency` detected on the call is a stop condition, not a triage instruction.

- Tell the caller to hang up and contact emergency services or the on-call human.
- End the call. Do not continue qualification.
- Flag the event for immediate human attention.
- Never relay medical instructions, and never assess whether an emergency is "real".

## Commitment Boundary

The call gathers, the human commits.

- Never confirm a booking slot as final. Say a person will confirm.
- Never quote prices, availability windows, or policy from memory.
- Never say anything the caller could reasonably treat as an accepted appointment.
- "Someone will confirm that time shortly" is acceptable. "You're booked" is not.

## Privacy and Retention

- Mask the caller's phone number in every summary, log, dashboard payload, and commit. Store only the masked form after processing.
- Do not store transcripts or recordings unless the deploying organization has a stated legal basis and has told the caller.
- Refer to the caller by opaque event id in audit records, not by number or name.
- Do not read the caller's number, name, or need to any third party during the call.

## Credentials

- Never print, log, or echo CALL-E tokens, dashboard tokens, or webhook URLs.
- Read credentials from environment variables (`CALLE_*`, `CALLBACKOPS_DASHBOARD_TOKEN`), never from command-line arguments or committed files.
- Redaction must walk nested objects; a redactor that only checks top-level keys leaks a token nested one level down.

## Cost and Duplicate Calls

Calls cost money and a person's attention. Both are finite.

- One missed-call event produces at most one conversation and at most two attempts total.
- The idempotency key is derived from the event and payload digest, and must be stable across retries.
- A client-side timeout does not mean the call was not placed; treat it as `needs-review` and reconcile, never auto-redial.
- Never place a "test" recovery call to a real person. Use a number the operator owns and has explicitly offered for testing.

## Stop Conditions

Stop, and report the blocker, when:

- the event is not from the business's own phone system, or lacks a unique id
- a required field is missing or ambiguous
- the number is suppressed, or the event was already processed
- the callback window or working-hours check fails
- the outcome is `needs-review` or unknown
- the caller asked not to be contacted

Stopping is a successful outcome. Guessing is not.
