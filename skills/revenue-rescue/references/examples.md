# Examples: Revenue Rescue

This document provides explicit, safe-to-inspect examples for triggering the Revenue Rescue skill. **All examples use fictional E.164 phone numbers and are designed to be run in dry-run mode by default.**

## 1. Mock Input Payload (Fixture)

The skill expects a structured JSON payload, typically delivered via a webhook from a billing provider (e.g., Stripe, Chargebee). 

**File:** `scripts/fixtures/mock-payload.json`
```json
{
  "customer_id": "cus_fixture_123456",
  "customer_phone": "+1-555-0100",
  "trigger_id": "evt_stripe_failed_fixture_987",
  "amount": 249.00,
  "failure_reason": "expired_card",
  "is_disputed": false,
  "timestamp": "2026-09-09T14:30:00Z"
}
```

## 2. Dry-Run Execution (No Live Calls)

To test the workflow without burning CALL-E credits or placing a real phone call, ensure your environment is configured for dry-run mode:

```bash
# Set the environment variable
export CALL_E_DRY_RUN=true

# Trigger the webhook locally (assuming a local backend on port 8000)
curl -X POST http://localhost:8000/webhook/revenue-rescue \
  -H "Content-Type: application/json" \
  -d @scripts/fixtures/mock-payload.json
```

**Expected Behavior:**
The system will evaluate the Decision Engine rules, bypass the actual CALL-E CLI invocation, and immediately return a mock structured result.

## 3. Expected Structured Output

When the skill executes successfully (or in dry-run mode), it returns a strictly typed JSON object that matches the `references/schema.json` definition:

```json
{
  "outcome": "payment_promised",
  "promised_date": "2026-09-10",
  "dispute_reason": null,
  "escalation_required": false,
  "notes": "Customer agreed to update card tomorrow via the secure email link."
}
```

## 4. Edge Case Examples (Decision Engine Filtering)

The Decision Engine will automatically block calls and return a `skipped` status in the following scenarios:

### A. Amount Below Threshold
**Input:** `amount: 12.50`
**Result:** The system skips the call to save costs.
```json
{
  "status": "skipped",
  "reason": "Amount below $50 threshold. Routing to automated email sequence."
}
```

### B. Known Dispute
**Input:** `is_disputed: true`
**Result:** The system skips the call to avoid antagonizing the customer.
```json
{
  "status": "skipped",
  "reason": "Known dispute detected. Routing directly to human support queue."
}
```

### C. Outside Quiet Hours
**Input:** `timestamp: "2026-09-09T23:30:00Z"` (11:30 PM local time)
**Result:** The system queues the task for the next morning.
```json
{
  "status": "queued",
  "reason": "Outside safe calling hours (08:00 - 21:00). Scheduled for next business day."
}
```
