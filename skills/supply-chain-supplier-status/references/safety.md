# Safety Reference

Autonomous supplier inquiry calls interact with external commercial counterparties. Strict guardrails ensure legal compliance, telecommunications privacy, and operational integrity.

## Authorization And Contact Basis

1. **Explicit Operator Authorization Required:**
   - Every outbound verification run requires explicit operator confirmation (`authorization_confirmed: true`) and destination authorization (`destination_authorized: true`) before dispatch.
   - Refuse to dispatch calls based on automated unverified triggers or inferred numbers.

2. **Pre-Existing Commercial Relationship Required:**
   - Calls must only be placed to verified vendors holding an active Purchase Order (PO) or commercial supply agreement with the procuring organization.
   - Cold calling, prospecting, or dialing unverified numbers is strictly prohibited.

3. **Caller Identity & Recorded Line Disclosure:**
   - The agent must immediately state its identity, the procuring organization it represents, and disclose that the call is being recorded for order verification purposes.
   - If the recipient does not consent to call recording, the agent must terminate or fail-closed to a human follow-up.

4. **Business Hours & Calling Windows:**
   - Calls must only be dispatched during standard local commercial hours (08:00 to 18:00 in the supplier local timezone).
   - Automated weekend and holiday dialing is disabled by default.

## Telephone Number Formatting & Masking

1. **E.164 Compliance:**
   - All destination phone numbers must be formatted in E.164 international notation (`^\+[1-9]\d{6,14}$`, e.g., `+15550149923`).
   - Documentation and synthetic fixtures must use reserved fictional test prefixes (such as `+15550100000` through `+15550199999`).

2. **Redaction & Privacy Masking:**
   - All telephone numbers displayed in dashboards, CLI outputs, pull requests, issue logs, or export files must be masked (e.g., `+1-555-***-9923`).
   - Returned provider metadata, internal telephony tokens, and carrier trace headers must be stripped from downstream reporting.
   - Personal names and direct lines captured during escalation must be stored solely within internal procurement records.

## Ambiguity Stop & Deduplication Contract

1. **Stop on Ambiguous Submission:**
   - If purchase order identifiers, supplier identities, contact phone numbers, or delivery commitments are ambiguous, conflicting, or unverified, the agent must stop immediately.
   - Fail-closed to a human procurement operator for manual clarification; never proceed with automated calling on uncertain parameters.

2. **Rate Limiting & Duplicate Call Prevention:**
   - Idempotency keys bound to `supplier-status:{purchase_order_id}:{supplier_id}:{scheduled_delivery_date}:v1` prevent duplicate calls on the same day.
   - If a call is unanswered, encounters a network timeout, or returns an ambiguous dispatch status, the agent must not automatically redial or launch parallel attempts. Defer retries and route to human review.

## Cancellation Limits

1. **No In-Flight Call Recall:**
   - The CALL-E Calls API does not provide an endpoint to cancel, recall, or interrupt a call once dispatched to the telephony provider.
   - Terminating a local script, closing a browser tab, or engaging an application stop flag does not terminate an active in-flight phone call on the carrier network.

2. **Wave Scope Management:**
   - Application kill switches and abort handlers only prevent *subsequent* queued or future wave calls from being initiated.
   - Operators must keep verification waves small, inspect preflight parameters, and confirm authorization prior to execution.

## Decision Authority & Commercial Boundaries

1. **Information Gathering Only:**
   - The agent is strictly an intelligence-gathering and schedule-coordination tool.
   - The agent has no legal or commercial authority to cancel contracts, waive liquidated damages, alter payment terms, or accept defective goods.

2. **Human-in-the-Loop Escalation:**
   - Any identified delay exceeding contractual tolerance, significant financial penalty exposure, or critical component shortage is flagged with `requires_escalation: true` for procurement manager review.
