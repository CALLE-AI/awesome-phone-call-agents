# AttestCall — Devpost submission

## Project name
AttestCall

## Elevator pitch (one line)
Turn a compliance question into a dated, evidence-grounded, hash-chained attestation record — with one disclosed CALL-E phone call.

## Inspiration / Problem
Vendor risk and compliance teams constantly need *point-in-time* attestations from third parties: "Are you still PCI DSS compliant? When does your certificate expire? Who audited you?" In practice this is an email thread that produces undated, unverifiable claims that are painful to audit later. The missing piece isn't more software — it's getting a real person to say it, on a consented and recorded line, and turning that into a verifiable record.

## What it does
AttestCall places one disclosed, consent-gated phone call through CALL-E to a vendor's compliance contact. It:
- discloses it is an automated assistant and that the call may be recorded, and asks for consent first;
- captures a strict result schema — compliance status, certificate expiry, auditor, attesting contact, consent, scope caveats;
- classifies the outcome **fail-closed** into `attested`, `not_attested`, `needs_human`, or `call_failed`; and
- seals the result into an append-only, SHA-256 **hash-chained** audit log that is tamper-evident.

Anything short of a clean, consented, high-confidence, evidence-backed "yes" routes to a human.

## How CALL-E is used
CALL-E is imported and invoked at runtime via the official `@call-e/calle` TypeScript SDK. The single integration point (`src/calle.ts`) calls:

```ts
const client = new CalleClient({ apiKey });
const call = await client.calls.createAndWait(
  { task, recipient: { phone, region, locale }, resultSchema, metadata },
  { idempotencyKey, timeoutMs },
);
```

We rely on CALL-E's `structuredResult` (validated against our `resultSchema`), `evidence` quotes, `completionConfidence`, and terminal `status`/`taskCompleted` — exactly the signals a fail-closed compliance workflow needs.

## Architecture
- **CLI + zero-dependency HTTP server** (Node built-ins) with a compliance-console dashboard.
- **CALL-E layer** isolates all SDK use; a demo mode returns fixtures with the identical `Call` shape so the entire pipeline runs with no credentials and no network.
- **Attestation logic**: disclosed task builder, authorization-derived idempotency, fail-closed classifier.
- **Audit chain**: SHA-256 hash-chained, append-only, with an integrity verifier.

## Technical implementation highlights
- Strict JSON result schema with `"unknown"` and `null` as first-class answers so the agent never guesses.
- Idempotency key derived from the authorization (vendor + framework + reference + day), not the attempt, to prevent double-dialing.
- Phone numbers masked everywhere and never written to the audit log (enforced by a test).
- 16 tests, all running with zero live calls.

## Real-world impact
Third-party risk management is a mandated, recurring enterprise function. AttestCall converts a slow, unverifiable email chase into a fast, consented, evidence-grounded, tamper-evident record — a direction worth building into a real vendor-risk platform (scheduled re-attestation, expiry-driven triggers, GRC export).

## What's next
- Scheduled re-attestation before certificate expiry dates captured on prior calls.
- Webhook-driven ingestion for long calls (CALL-E `webhookUrl`).
- Export to GRC tools (ServiceNow, Vanta, Drata) and signed evidence bundles.

## How we built it during the submission period
Newly created for this hackathon. Verified against the real `@call-e/calle` v0.7.0 API surface; built, typechecked, tested (16/16), and exercised end-to-end via CLI and dashboard.

## Submission repo path
`apps/typescript/attestcall` in a fork of `CALLE-AI/awesome-phone-call-agents` (PR).

## CALL-E account email
<add the email associated with your CALL-E account on the Devpost form>
