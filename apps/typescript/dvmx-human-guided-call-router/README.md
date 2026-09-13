# DVMX Human-Guided Call Router

A focused TypeScript safety pattern for CALL-E-style phone-call workflows. It evaluates a call before execution, keeps a no-call fixture path as the default demonstration, and separately evaluates consequential follow-up actions.

## Why this exists

Phone-call agents can create real-world side effects. This example keeps the execution boundary explicit:

request
→ E.164 / recipient / consent / sensitive-domain policy
→ CALL-E provider boundary
→ structured result
→ follow-up policy
→ human approval when consequential

The sample in this repository does **not** place a phone call. It is a deterministic no-network fixture that demonstrates the policy layer.

## Requirements

- Node.js 20 or newer

No third-party packages are required.

## Run the no-call demo

```bash
npm run demo
```

Expected behavior:

- prints `NO_CALL_FIXTURE`
- masks the fictional recipient number
- performs no network request
- places no phone call
- shows the call-policy decision
- shows the follow-up-policy decision

## Tests

```bash
npm test
```

## Side effects

The included demo has **no external side effects**. It does not contact CALL-E, dial a phone number, schedule a job, write to a CRM, make a payment, or execute a follow-up action.

A production integration may place a real outbound phone call after the host explicitly opts in and supplies a CALL-E credential. Such a live path should keep all of the following outside browser/client code:

- API credentials
- recipient allow/deny lists
- call budgets and quotas
- approval state
- audit records

## Credential handling

Never commit `CALLE_API_KEY` or any other credential. Store credentials in the host/server environment only.

Do not print credentials into logs, screenshots, fixture files, or PR descriptions.

## Phone-number handling

Use E.164 formatting for real recipients. Examples in this app are fictional and output is masked to the final four digits.

## Consent and safety policy

This reference applies the following behavior before a provider call:

- invalid E.164 → `DENY`
- blocked recipient → `DENY`
- secret/password/private-key collection → `DENY`
- unconfirmed consent → `REQUIRE_HUMAN`
- medical/legal/financial/employment/collections domain → `REQUIRE_HUMAN`
- consented general-purpose request → `ALLOW`

After a call, purchase, payment, contract, service cancellation, or medical scheduling requests remain human-controlled.

## Cancellation / rollback

This example does not create calls or recurring jobs, so there is nothing to cancel.

For a live integration, the host should treat the provider call ID as the cancellation/inspection handle and must not create hidden recurring schedules. Budget reservations should be released if provider creation fails.

## Live verification

Live verification is intentionally **not** part of the default repository demo.

A live host integration should:

1. require an explicit operator action,
2. use an authorized recipient,
3. load `CALLE_API_KEY` from the server environment,
4. create at most the approved call,
5. retain the provider call ID,
6. monitor it to a terminal state,
7. route structured outcomes through the follow-up policy,
8. redact phone numbers and credentials from published evidence.

## Provider

Designed around CALL-E phone-call workflows, while keeping the policy and approval layer provider-separated.
