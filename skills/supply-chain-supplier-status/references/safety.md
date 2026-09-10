# Safety Reference

Autonomous supplier inquiry calls interact with external commercial counterparties. Strict guardrails ensure legal compliance, telecommunications privacy, and operational integrity.

## Authorization And Contact Basis

1. **Pre-Existing Commercial Relationship Required:**
   - Calls must only be placed to verified vendors holding an active Purchase Order (PO) or supply agreement with the procuring organization.
   - Cold calling, prospecting, or dialing unverified numbers is strictly prohibited.

2. **Caller Identity & Recorded Line Disclosure:**
   - The agent must immediately state its identity, the procuring organization it represents, and disclose that the call is being recorded for order verification purposes.
   - If the recipient does not consent to call recording, the agent must terminate or fail-closed to a human follow-up.

3. **Business Hours & Calling Windows:**
   - Calls must only be dispatched during standard local commercial hours (08:00 to 18:00 in the supplier local timezone).
   - Automated weekend and holiday dialing is disabled by default.

## Telephone Number Formatting & Masking

1. **E.164 Compliance:**
   - All destination phone numbers must be formatted in E.164 international notation (e.g., `+15550149923`).
   - Documentation and synthetic fixtures must use reserved fictional test prefixes (such as `+15550100000` through `+15550199999`).

2. **Redaction & Privacy Masking:**
   - Phone numbers displayed in dashboards, CLI outputs, pull requests, or issue logs must be masked (e.g., `+1-555-***-9923`).
   - Personal names and direct lines captured during escalation must be stored solely within internal procurement records.

## Decision Authority & Commercial Boundaries

1. **Information Gathering Only:**
   - The agent is strictly an intelligence-gathering and schedule-coordination tool.
   - The agent has no legal or commercial authority to cancel contracts, waive liquidated damages, alter payment terms, or accept defective goods.

2. **Human-in-the-Loop Escalation:**
   - Any identified delay exceeding contractual tolerance, significant financial penalty exposure, or critical component shortage is flagged with `requires_escalation: true` for procurement manager review.

3. **Rate Limiting & Duplicate Call Prevention:**
   - Idempotency keys bound to `(supplier_id, purchase_order_id, date)` prevent duplicate calls on the same day.
   - If a call is unanswered or reaches voicemail, the agent logs a non-response disposition and defers retries according to configurable backoff intervals rather than redialing repeatedly.
