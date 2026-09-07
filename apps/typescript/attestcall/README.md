# AttestCall

**Turn a compliance question into a dated, evidence-grounded, hash-chained attestation record — with one disclosed CALL-E phone call.**

Vendor risk and compliance teams routinely need *point-in-time* attestations from third parties: "Are you still PCI DSS compliant? When does your certificate expire? Who is your auditor?" Today that means chasing email threads that produce unverifiable, undated claims. AttestCall places one disclosed, consent-gated phone call via [CALL-E](https://www.heycall-e.com/), captures the answers grounded in transcript evidence, and seals a **tamper-evident audit record** — failing closed to human review whenever anything is uncertain.

This is not "an AI that makes phone calls." It is a compliance decision system in which the phone call is the actuator that produces an auditable record.

---

## What it does

1. **Preview (no call).** Renders the exact disclosed script, the masked destination number, and a stable idempotency key so an operator can inspect everything *before* any call is placed.
2. **Attest (the call).** CALL-E dials the vendor contact, discloses that it is an automated assistant and that the call may be recorded, asks for consent, then captures a strict result schema: compliance status, certificate expiry, auditor, attesting contact, consent, and scope caveats.
3. **Classify (fail-closed).** The result is classified into `attested`, `not_attested`, `needs_human`, or `call_failed`. Low confidence, missing consent, ambiguity, or an unknown status all route to a **human**, never a silent success.
4. **Seal (hash-chained).** Each outcome is appended to an append-only, SHA-256 hash-chained audit log. Any retroactive edit to an earlier record invalidates every hash after it.

## Why CALL-E is the right primitive

The attestation only has evidentiary value if a real person actually says it on a recorded, consented line. CALL-E handles the disclosure, consent capture, natural conversation, IVR navigation, and returns a schema-validated `structuredResult` plus `evidence` quotes and a `completionConfidence` score — exactly the inputs a fail-closed compliance workflow needs.

---

## Quick start (demo mode — no credentials, no calls)

```bash
cd apps/typescript/attestcall
npm install
npm run build
npm test          # 16 tests, zero live calls

# CLI
npm run cli -- preview --vendor "Acme Payments Inc." --phone +14155550123 --framework PCI-DSS --by "Vendor Risk"
npm run cli -- attest  --vendor "Acme Payments Inc." --phone +14155550123 --framework PCI-DSS --by "Vendor Risk" --scenario compliant
npm run cli -- verify

# Dashboard
npm run dev       # then open http://localhost:4600
```

Demo mode is **on by default** (fail-safe): nothing calls out unless you explicitly opt in. Demo runs return deterministic fixtures with the exact `Call` shape the real SDK returns, so the full flow — classification, sealing, dashboard — is identical to live.

Demo scenarios: `compliant`, `non_compliant`, `no_consent`, `low_confidence`, `call_failed`.

## Live mode (places a REAL phone call)

```bash
cp .env.example .env
# edit .env:
#   DEMO_MODE=false
#   CALLE_API_KEY=calle_live_...   (from https://dashboard.heycall-e.com/account/api-keys)
npm run build && npm start
```

In live mode, `src/calle.ts` calls `client.calls.createAndWait(...)` from `@call-e/calle`, dials the number, and waits for a terminal result. **This places a real, billable phone call to a real person.** Only use numbers you are authorized to call.

---

## CALL-E integration (where the real call happens)

`src/calle.ts` — the only module that talks to CALL-E:

```ts
import { CalleClient } from "@call-e/calle";
const client = new CalleClient({ apiKey: options.apiKey });
const call = await client.calls.createAndWait(
  { task, recipient: { phone, region, locale }, resultSchema, metadata },
  { idempotencyKey, timeoutMs },
);
// -> call.status, call.taskCompleted, call.completionConfidence, call.structuredResult, call.evidence
```

The result schema handed to CALL-E lives in `src/types.ts` (`ATTESTATION_RESULT_SCHEMA`).

## Safety & side effects

See [`docs/safety.md`](docs/safety.md) for the full reference. Summary:

- **Consent-first.** The call discloses AI use and recording, and asks for consent before capturing anything. No consent → `needs_human`, nothing recorded as attested.
- **Fail-closed.** Ambiguity, low confidence, or unknown status route to a human. See `classify()` in `src/attest.ts`.
- **Phone privacy.** Numbers are masked in every preview, record, and log (`+1********23`). The raw number is never written to the audit log (enforced by a test).
- **Idempotency.** The idempotency key is derived from the *authorization* (vendor + framework + reference + day), not the attempt, so a retry cannot double-dial.
- **Side effect.** Live mode places one outbound phone call per attest. Demo mode places none.
- **Cancellation / rollback.** There are no recurring jobs. To stop: run in demo mode, or unset `CALLE_API_KEY`. The audit log is append-only; delete `data/attestations.log` to reset local records.
- **Non-contractual.** A spoken attestation is evidence for follow-up, not a legal certification. The record is designed to support a human compliance decision, not replace it.

## Project layout

```
apps/typescript/attestcall/
├── src/
│   ├── types.ts       # domain types + strict CALL-E result schema
│   ├── calle.ts       # CALL-E SDK integration (live) + demo dispatch
│   ├── attest.ts      # task/script builder, fail-closed classification, idempotency
│   ├── audit.ts       # SHA-256 hash-chained audit log
│   ├── fixtures.ts    # deterministic demo Call fixtures (5 scenarios)
│   ├── runner.ts      # preview + execute orchestration
│   ├── config.ts      # env loader (demo default ON)
│   ├── cli.ts         # preview / attest / verify commands
│   ├── server.ts      # dashboard + JSON API (Node built-ins only)
│   └── public/index.html  # compliance console UI
├── test/attestcall.test.ts  # 16 tests, zero live calls
├── examples/attestation-request.json
├── docs/safety.md
└── docs/demo-script.md
```

## Testing for judges

Everything above runs with **no CALL-E account and no network**. `npm test` exercises the full pipeline (validation, disclosure, classification, hash chain, phone privacy) against fixtures. Live verification is opt-in via `.env`.

## License

MIT.
