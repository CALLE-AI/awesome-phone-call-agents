# Safety

Phone calls are real-world side effects and an escalation call carries a second
weight: it wakes a person up at night to hand them a running incident.

## Explicit intent

Place a call only when the user asked to escalate this incident, in this
conversation. A plan, a draft incident file or a question about how escalation
works is not a request to ring anybody. Preview first, show the ladder and the
call task, then ask.

## Enrolment is the consent record

A person is callable only when the rotation file lists them with:

- `phone` in E.164 form, for example `+14155550100`
- `timezone`, the IANA zone their on-call windows are interpreted in
- a shift whose window covers the moment of the run

Being in the rotation file is the agreement to be woken up.
Enrolling a new number or changing one is a security event, not a convenience.
Treat it the way you treat adding a production credential.

## Phone numbers

Never guess a number, a country code, a region or a locale. A number that is
not E.164 is rejected, never reformatted. Mask numbers in everything you show
the user; full numbers stay in the rotation file.

## Credentials

`CALLE_API_KEY` and `CALLE_MCP_TOKEN` live in the environment or a secret
manager. Never put either in the incident file, never echo them, never write
them into a log line or a commit. The two channels do not share credentials,
and each is pinned to its own exact live URL: a different port, path or host is
a different target and is refused, pointing one channel's flag at the other
channel's endpoint is refused the same way, and there is no flag that permits
either. A run against a local fake reads `RINGDOWN_FAKE_API_KEY` and
`RINGDOWN_FAKE_MCP_TOKEN` instead, so the live credentials never travel over
plaintext loopback.

## No hidden or duplicate work

One run walks the ladder once, top down, and stops at the first decision.
Nothing recurring is created, so there is no schedule to cancel. Each
attempt's idempotency key is derived from its content, so a retried step does
not ring a person twice.

If the run exits 25, the state of a call could not be established and a phone
may still be ringing. Do not run again. Report the call id from the output and
let a person reconcile it first.

## Voicemail and the wrong person

An answering machine or a person who is not the expected engineer is not an
acknowledgement, and the ladder moves on. Incident details do not belong on a
recording, and a commitment spoken by somebody other than the person who was
dialled does not count.

## A decline is final

An explicit "no, I can't take this" ends the ladder. Do not ring the next
person hoping for a yes, do not re-run the ladder and do not describe a decline
as a soft maybe. Report who declined and stop: the decision to page somebody
else belongs to a person.

## Cancellation

A call already connected cannot be cancelled; that is a platform limit. What
can be stopped is the ladder: stopping the process places no further calls. Say
so honestly instead of promising a kill switch that does not exist.

## Boundaries this skill does not cross

- **Medical.** Never place an escalation call about treatment, medication,
  diagnosis or a clinical decision.
- **Legal.** Never seek consent, waiver or any legal authorization by phone
  through this skill.
- **Financial advice.** Escalating an incident in a payments system is in
  scope. Advising on an investment, a loan or a credit decision is not.
- **Emergencies.** Never use this skill to reach emergency services and never
  place it in the path of one. If a person on a call describes an emergency,
  end the call and tell the user to contact local emergency services.
- **Consumer outreach.** This is an internal paging tool. Do not point it at
  customers, leads or any list of people who did not enrol in the rotation.

## What an acknowledgement does not prove

Answering an enrolled handset is possession of that handset, not proof of
identity. And the verification grounds every field in literal transcript text:
it proves the words were spoken by the person who answered, not that the person
understood the incident or will actually fix it. The full position is in the
app README's [known ceilings](../../../apps/python/ringdown/README.md#known-ceilings).
