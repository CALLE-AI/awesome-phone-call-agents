# AttestCall Safety Reference

Compliance attestation calls have real-world side effects and produce records that may be relied upon later. This document states the boundaries AttestCall enforces.

## Consent and disclosure

- Every call opens by disclosing that the caller is an **automated assistant**, that the purpose is to record a **point-in-time compliance attestation**, and that the call **may be recorded**. This is built into the task text (`buildAttestationTask` in `src/attest.ts`) and cannot be silently removed without changing the code.
- The call asks for **consent to record before** capturing any attestation. If the recipient declines, the disposition is `needs_human` and nothing is recorded as attested.

## Fail-closed classification

`classify()` in `src/attest.ts` never treats ambiguity as success:

| Condition | Disposition |
| --- | --- |
| Call not completed / `taskCompleted !== true` | `call_failed` |
| `completionConfidence.score < 0.75` | `needs_human` |
| `consent_to_record !== "yes"` | `needs_human` |
| `is_compliant === "unknown"` | `needs_human` |
| `is_compliant === "no"` | `not_attested` |
| `is_compliant === "yes"` **and** consent **and** confidence ok **and** evidence present | `attested` |

`attested` is the *only* success branch, and it requires at least one grounding evidence quote from CALL-E. "unknown" is a first-class answer in the schema so the agent is never pushed to guess.

## Phone-number handling (E.164)

- Destination numbers must be valid E.164 (`isE164` in `src/util.ts`); junk input fails closed before any call.
- Numbers are **masked** (`+1********23`) in every preview, dashboard view, audit record, and log line.
- The raw number is **never** written to the audit log. This is enforced by the test `audit record never stores raw phone`.
- Any phone-like substring inside CALL-E evidence text is redacted before sealing (`redactPhonesInText`).

## Idempotency and duplicate-call prevention

- The idempotency key is derived from the **authorization** — vendor phone + framework + reference id + UTC day — not from the attempt (`deriveIdempotencyKey`). Two identical authorized requests on the same day collapse to one call at the CALL-E layer.
- Reserve-before-dial is inherent: the key is computed in `preview` and reused in `run`.

## Credential boundaries

- `CALLE_API_KEY` is read only from the environment on the server/CLI side. It is never sent to the browser and never written to the audit log or any response body.
- Demo mode requires no credentials at all.

## Side effects and cancellation

- **Side effect:** live mode places exactly one outbound phone call per `attest`. Demo mode places none.
- **No recurring jobs:** AttestCall does not schedule or repeat calls, so there is nothing to cancel mid-flight beyond the single in-progress call.
- **Stop placing calls:** set `DEMO_MODE=true` or unset `CALLE_API_KEY`.
- **Reset local records:** the audit log is append-only by design; delete `data/attestations.log` to clear local history.

## Scope and non-goals

- A spoken attestation captured by AttestCall is **evidence to support a human compliance decision**, not a binding legal certification. The record is explicitly designed to route to a human for anything short of a clean, consented, high-confidence, evidence-backed "yes".
- AttestCall does not give legal, financial, or regulatory advice. It records what a person said, when, and with what confidence.
- Do not call numbers you are not authorized to call. Regulatory frameworks (TCPA and equivalents) govern outbound calling; the operator is responsible for authorization.
