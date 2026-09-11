# Evidence And Deterministic Classification

## Evidence Rules

The twelve required fields are `contact_identity`, `contact_role`, `decision_authority`, `deliverables`, `exclusions`, `budget_range_currency`, `payment_method`, `funding_or_deposit_status`, `payment_timing`, `deadline_timezone`, `access_prerequisites`, and `acceptance_criteria`. `unresolved_risks` is also collected and may explicitly be `none stated`.

A field is verified only when all are true:

1. Call status is `COMPLETED`.
2. The quote is a substantive complete sentence (at least three words and twelve characters) from exactly one callee turn after case-folding and whitespace normalization. Inner substrings, quoted/negated claims, and turns containing broad false-context markers do not verify facts.
3. A conservative field-specific parser can derive the field state or value from that quote. The provider's structured `value` is checked only for consistency; it is never trusted as evidence.
4. The quote is not voicemail, refusal, silence, hearsay, a generic affirmation, or a statement that the speaker does not know.
5. The same quote is not reused for another field. Duplicate or ambiguous evidence invalidates every affected field.

Authority is normalized to `SELF_FINAL`, `SELF_PARTIAL`, `THIRD_PARTY`, `NONE`, or `UNKNOWN`. Funding is normalized to `FUNDED`, `NOT_FUNDED`, `PENDING`, `CONDITIONAL`, or `UNKNOWN`. Risks are normalized to `NONE`, `RISKS_PRESENT`, or `UNKNOWN`. Conditional or future funding is never `FUNDED`.

Never infer one field from another. A title does not prove decision authority. A budget does not prove funding. A deadline without a timezone is unresolved. “Standard terms” does not establish payment timing.

## Recommendation Rules

Evaluate in this order:

1. `NO-GO` if status is not `COMPLETED`; the callee refuses; identity is missing; or authority is anything other than `SELF_FINAL`.
2. `GO` only if every required field is verified, authority is `SELF_FINAL`, funding is unconditional `FUNDED`, risks are verified as `NONE`, and there is no duplicate or ambiguous evidence.
3. `CAUTION` for every other completed, non-refused call with verified identity and `SELF_FINAL` authority. This includes missing, ambiguous, conflicting, risky, pending, conditional, or unfunded facts.

The rule is intentionally conservative and deterministic. It does not score attractiveness, compare price to market, negotiate, or decide whether to accept. `GO` means the verification record is complete under this rule, not that the project is good or accepted.

Reasons are emitted in field order. Verified and unresolved fact lists use the same order, making the human-review brief stable for identical evidence.
