# Safety

Phone calls are real-world side effects and an approval call carries a second
weight: something irreversible happens right after it.

## Explicit intent

Place a call only when the user asked for the action that needs approval, in this
conversation. A plan, a draft or a question about how approvals work is not a
request to ring anybody. Preview first, show the call script, then ask.

## Enrolment is the consent record

An approver is callable only when the request file lists them with:

- `phone` in E.164 form, for example `+14155550100`
- `enrolled_at`, the date they agreed to be called for approvals
- `authorized_for`, the environments they may approve

The gate refuses an approver whose scope does not cover `change.environment`.
Enrolling a new number or changing one is a security event, not a convenience.
Treat it the way you treat adding a production credential.

## Phone numbers

Never guess a number, a country code, a region or a locale. Use E.164. Mask
numbers in everything you show the user: the gate prints `+14*******00` and the
audit record stores the masked form. Full numbers stay in the request file.

## Credentials

`CALLE_API_KEY` lives in the environment or a secret manager. Never put it in the
request file, never echo it, never write it into a log line or a commit.

## No hidden or duplicate work

One run places at most one call per approver, in ladder order and stops at the
first decision. Nothing recurring is created, so there is no schedule to cancel.
A retried step lands on the same idempotency key, which carries a digest of the
call it stands for, so a retry does not ring the approver twice and an edited
request does not quietly reuse an older call. The code for each attempt is
reserved on disk before the call, so a second run accepts the code the approver
was actually shown instead of a fresh one. Stopping the process stops the ladder.
A call already connected finishes on the CALL-E side and its outcome is simply not
used.

If the gate reports `call_state_unknown`, a call may still be live. Do not run it
again. Report the call id in the record and let a person reconcile it first.

## Voicemail and the wrong person

The call script asks who is on the line before it says anything about the change,
so a person who is not the expected approver hears no change detail. It ends on
voicemail, an answering machine or a menu system without describing the change and
without leaving a message. Change details do not belong on a recording.

## One rejection is final

Do not re-run the gate after a rejection, do not call a different approver hoping
for a yes and do not describe a `not_approved` verdict as a soft maybe. Report
the reason and stop.

## Boundaries this skill does not cross

- **Medical.** Never place an approval call about treatment, medication,
  diagnosis or a clinical decision.
- **Legal.** Never seek consent, waiver, settlement or any legal authorization by
  phone through this skill.
- **Financial advice.** Approving a payment batch as an operational step is in
  scope. Advising on an investment, a loan or a credit decision is not.
- **Emergencies.** Never use this skill to reach emergency services and never
  place it in the path of one. If a person on a call describes an emergency, end
  the call and tell the user to contact local emergency services.
- **Consumer outreach.** This is an internal authorization tool. Do not point it
  at customers, leads or any list of people who did not enrol as approvers.

## What the gate does not prove

Answering an enrolled handset is possession of that handset and nothing more. It
is not proof of identity. NIST SP 800-63B treats the phone network as a
restricted channel for out-of-band verification, so for changes where identity
really matters, pair the call with dual control or a second factor on the request
channel. The full position is in the app's
[threat model](../../../apps/typescript/phone-approval-gate/docs/threat-model.md).
