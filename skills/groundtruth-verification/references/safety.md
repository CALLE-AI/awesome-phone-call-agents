# Safety

GroundTruth verification is question-only. These rules are enforced at the
orchestration layer — not in a prompt the model can drift from.

## Authorization boundaries

Every verification task carries an explicit authorization block:

- **Allowed** (subset, always question-only): `ask_question`,
  `request_availability`, `request_pricing`, `request_delivery_estimate`,
  `request_pickup_window`, `request_hold`.
- **Prohibited** (mandatory, constant): `purchase`, `payment`,
  `contract_acceptance`, `legally_binding_commitment`,
  `disclose_credentials`, `disclose_payment_info`.

Enforcement points, in order:

1. **Goal validation** — a goal whose authorization list is missing any
   prohibition is rejected at creation.
2. **Plan-time action check** — every constraint's phone question maps to an
   allowed action; asking about a hold without `request_hold` in the allowed
   set throws before any call exists.
3. **Composition-time phrase gate** — the composed call task text is scanned
   for affirmative side-effect language (purchase/buy, pay/card, order
   confirmation, terms acceptance, credential sharing). Negations
   ("do NOT purchase") are stripped before scanning so the safety footer and
   disclosures never trip the gate. Affirmative phrases abort the call.
4. **Action ledger** — every created call and every blocked action is
   recorded (`actions` table) with the task, candidate, and call ids.

## Never send on a call

- Payment card numbers, CVVs, or any card-like digit string
- Passwords, one-time codes, API keys, tokens, any secret
- National identifiers, full addresses of the requester, or any personal data
  beyond what the question strictly requires

The standard disclosure states who is calling, that it is automated, on whose
behalf, and that no commitment will be made. Questions disclose nothing about
the requester beyond the item being verified.

## PII handling

- Phone numbers are masked in the UI (`+91 •••• ••01`); full E.164 numbers
  live only in the working state and the CALL-E call.
- Before persistence and display, free text (transcripts, notes, evidence
  excerpts) is redacted for: emails, card-like digit sequences, OTP-like
  codes, and secret-shaped strings.
- Human (callee) transcript turns are redacted; bot turns are safe by
  construction.
- Transcripts and evidence excerpts are the minimum necessary quote — not the
  full recording.

## Auditability

- Every significant action is in the audit log: task created, goal analyzed,
  CALL-E call created/completed/failed, claim verified/recorded, blocked
  action, decision reached — each with actor (`user` | `system` | `calle`)
  and timestamp.
- Webhook deliveries are deduplicated by event id and the raw payload is
  retained for dispute resolution.
- No secrets in logs: CALL-E keys and tokens are redacted in structured
  logging; phone numbers are masked.

## Failure behavior

- A candidate that cannot be reached is marked `unreachable` — never retried
  in the same run, never counted as a failure of its answers.
- A call that ends in ambiguity leaves claims UNKNOWN; the final decision is
  `partial`/`no_match`, never a soft success.
- Side-effect gate violations fail LOUDLY (the call is not silently rewritten).

## What this skill will never do

- Purchase, pay, reserve beyond a temporary hold, or accept any offer.
- Reveal, read back, or request codes or credentials on a call.
- Present an unverified or low-confidence answer as verified.
- Place calls without an explicit operator-initiated task.
