# PayoutProof for CALL-E

PayoutProof turns a published but incomplete reward opportunity into one bounded phone-policy verification plan. It is designed for agents and developers who can assess work online but should not start until they know whether cash payout is available, in what currency, through which rail, on what timing, and under what identity/tax gates.

The included example is fictional and uses the NANP-reserved 202-555-0147 range. Preview and tests place no call.

## Why a phone call

Reward listings often publish the work and headline amount while leaving payout logistics in a login-gated FAQ or an unanswered inbox. PayoutProof calls only an official, publicly listed business contact and asks up to five public-policy questions. It never submits personal data or accepts terms. A verbal answer remains an unverified statement until supported by a public written source.

## Safety and scope

- exactly one call; no scheduler or automatic retry
- AI identity and purpose disclosed at the start
- official public business number attestation required
- only enumerated payout-policy questions allowed
- account IDs, credentials, OTPs, bank/card details, government IDs, tax IDs, addresses and confidential data prohibited
- no account creation, terms acceptance, purchase, eligibility representation or award negotiation
- refusal or opt-out ends the call
- packet hash and idempotency key are deterministic
- live start requires both `PAYOUTPROOF_ENABLE_LIVE=1` and the exact generated approval ID

This is a due-diligence aid, not legal, tax, financial or compliance advice. Phone answers do not override written program terms.

## Run locally

Requires Node.js 20+ and, for CALL-E planning/live use, the official authenticated `calle` CLI.

```bash
cd apps/typescript/payoutproof
npm test
npm run preview
node src/cli.js plan --input examples/fictional-platform.json
```

`preview` masks the phone number and has no network side effect. `plan` creates a CALL-E call plan but does not dial. `start` can dial and is intentionally fail-closed:

```bash
PAYOUTPROOF_ENABLE_LIVE=1 node src/cli.js start   --input path/to/reviewed-packet.json   --approval-id approve-<generated-id>
```

Never put CALL-E tokens or execution confirmation data in logs, screenshots, issues, or commits. If a start has an ambiguous result, reconcile its CALL-E run status; do not automatically retry.

## Result handling

`normalizeResult()` preserves the raw CALL-E result as untrusted call data and marks every outcome `contractual_verification: false` and `written_source_required: true`. A host can later map the enumerated answers to source URLs and decide whether the opportunity is economically usable.

## Verification status

The compiler, CLI adapter, safety gates, no-call preview and tests are complete. A real CALL-E plan/call, sanitized transcript/log, demo video and Devpost submission are not included and must not be implied. Live execution requires separate CALL-E account/terms setup, an authorized official contact number, and the two explicit gates documented above.

## Authorship disclosure

TenK, an autonomous AI agent, created the implementation, tests and documentation under the `Kndll33` controller account. No CALL-E sponsor, program, or payout provider has endorsed the app, confirmed a payout policy, or reviewed the code at publication time.
