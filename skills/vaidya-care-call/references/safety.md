# Vaidya Care Call Safety

## Core Principle

A language model must never be the sole authority for initiating a healthcare phone call.

The workflow must separate:

1. model recommendation
2. deterministic safety validation
3. no-call preview
4. explicit operator approval
5. live CALL-E execution

## No-Call Preview

Preview mode must not contact the patient.

The preview should show:

- proposed call reason
- care decision
- risk level
- priority
- safety-gate result
- destination authorization status
- masked destination
- operator approval requirement

Example:

```text
Safety gate: PASS
Destination: +91••••••5837
Live call: NOT STARTED
Operator approval: REQUIRED
Operator Approval

A live call requires explicit operator approval after the preview has been generated.

The following is not sufficient:

model recommendation
automatic care decision
a valid phone number alone
a passing risk threshold alone

If operator approval is missing, do not initiate CALL-E.

Authorized Destinations

Only an explicitly authorized destination may be used.

Destinations must:

be valid E.164 numbers
belong to an approved demonstration or run
come from trusted application state
not be taken from arbitrary model output

Public examples must use masked or fake numbers.

Deterministic Safety

The deterministic safety gate must remain authoritative.

A model must not be able to:

bypass the gate
change the gate
grant itself permission
select an unauthorized destination
convert a blocked decision into an approved call
Masking

Never expose complete phone numbers in:

logs
screenshots
README files
examples
public repositories

Use masking such as:

+91••••••5837

Use fake identifiers for examples:

patient: CT-DEMO-102
call_id: call_demo_••••
Unknown Outcomes

An unknown or ambiguous provider result is a hard stop.

Do not infer:

patient reached
patient not reached
health improved
health worsened
symptoms
medication adherence

Do not create a patient event from an unverified result.

Do not automatically retry.

First reconcile the provider's call status. Continue only after a trustworthy terminal state is available.

Cancellation

Preview cancellation is always possible because no call has been placed.

Before initiation, cancellation means withholding operator approval.

After provider acceptance, cancellation depends on the provider's actual state.

A connected or accepted call may not be cancellable.

The system must report the real provider state rather than claiming cancellation succeeded when it cannot be verified.

Community Safety

This skill is a reusable demonstration workflow.

Do not include real patient data, production credentials, private phone numbers, or secrets.

The skill does not replace professional medical judgment.