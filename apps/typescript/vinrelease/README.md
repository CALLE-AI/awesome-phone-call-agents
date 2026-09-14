# VINRelease

VINRelease is an evidence-first phone workflow for used-car dealership title exceptions. An auction call can identify the party blocking title issuance; a second, separately approved lienholder call can return a transmission reference. The workflow never treats “sent” as proof of physical receipt and routes unknown or unsafe answers to a title clerk.

This directory contains the portable decision core and a deterministic two-call replay. The full Next.js operator workbench, deployment, screenshots, and wider test suite live in the [VINRelease project repository](https://github.com/vivekyarra/vinrelease).

## Credential-free replay

Requires Node.js 20 or newer.

```bash
cd apps/typescript/vinrelease
npm install
npm test
npm run demo
```

Expected final line:

```text
WAITING_EXTERNAL | release_sent_not_received | ref LR-4721
```

The default path uses fixtures and cannot place a call.

## Workflow boundary

1. Start with one overdue vehicle and an approved auction title-desk contact.
2. Render a masked call preview and bind approval to its exact content.
3. Submit one CALL-E task with a stable idempotency key and strict `recipientResultSchema`.
4. Accept only a locally validated result.
5. Move to the next responsible party or stop for human review.
6. Keep “release sent” in `WAITING_EXTERNAL` until receipt is independently confirmed.

## Side effects and cancellation

Replay mode has no external side effects. The full app's opt-in live mode submits exactly one outbound CALL-E task to one pre-provisioned, consenting E.164 destination after explicit approval. It has no scheduler and never retries automatically. Resetting the local case does not cancel a provider task. If a live task is queued or running, inspect or stop it in the CALL-E dashboard before taking another action.

The workflow excludes arbitrary number entry, credentials, bank or payment data, fees, legal representations, medical or emergency use, and unverified claims. Phone numbers are masked in summaries. A wrong department, unknown question, document rejection, or credential request becomes human review.

## Credentials

The full app reads `CALLE_API_KEY` only on the server and uses the official `@call-e/calle` TypeScript SDK. Never put the key, raw phone numbers, transcripts, or provider payloads in source control. Use a participant-controlled or explicitly consenting destination for live verification.

## Verification

`npm test` checks the golden path and the credential-request stop. The repository-wide validator should also pass from the repository root:

```bash
python3 scripts/validate_repository.py
```
