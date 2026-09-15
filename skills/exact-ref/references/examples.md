# Examples

`OH-01` is the off-hire exception from the 2026-09-05 live call. It holds two write-gates: FS-01 (reference) and FS-02 (collection window). OffHire Desk is not the product.

All fixtures here and in `fixtures.json` / `call-fs01.json` are synthetic reconstructions: the identifier values and outcome are real, the evidence strings are illustrative, and no transcript, recording, or phone number is included. `node scripts/exactref.mjs fixtures` re-classifies every fixture and exits `1` if any disagrees with its expected provenance.

## FS-01 — live substitution (hero)

Intended `07198FECTIST`. CALL-E extracted `07198SECTIST` after a full readback and “yes” (one authorized Calls API call, 2026-09-05, Python SDK 0.7.0). Schema-valid.

ExactRef: `mismatch`, not writable. Character 6 is F vs S. Summary “Sunday 5 PM” is ignored for scheduling.

## FS-02 — contradictory time

Recipient said Sunday morning and 5:00 PM. Structured field can keep both. The public summary picked 5 PM. ExactRef will not treat the summary clock time as a fact.

## FS-03 — matching ticket, still not writable

Intended and extracted `TK-44019`, readback confirmed, no second channel → `conversational_confirmed`. A human must type the value and claim a second channel before write.

## FS-04 — nothing extracted

`unknown`. Do not mint a pickup number.

## FS-05 — zero vs letter O

Intended `PO-1040`. Extracted `PO-1O40` after readback-plus-yes. ExactRef: `mismatch`. Digit/letter homophones are the same class as F/S.

## Agent flow

```text
1. `compile` the task. Confirm it does not contain the intended identifier (exit 2 if it does).
2. The host places at most one call, only on explicit user intent. This skill never dials; use a saved fixture when no call is wanted.
3. `gate` the returned call object (or `classify` the extracted value). Non-terminal or no `structured_result` → `unknown`, write nothing.
4. If `mismatch` or `spoken_only`, stop. Offer keep-spoken-only or a typed second-channel `verify`.
5. Never create a second call because status is `queued`.
```
