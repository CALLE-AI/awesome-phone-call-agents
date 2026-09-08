---
name: "revenue-rescue"
title: "Revenue Rescue"
description: "Autonomous, governed revenue recovery agent skill that detects high-value operational exceptions (e.g., failed payments), evaluates business rules, and executes multi-step CALL-E phone interactions with strict safety boundaries."
tags: ["revenue", "finance", "safety", "governed", "automation", "payments"]
---

# Revenue Rescue Skill

## Overview
**Revenue Rescue** is an autonomous, governed revenue recovery agent skill. It detects high-value operational exceptions (e.g., failed Stripe payments, critical shift gaps), evaluates them through a "Should We Call?" decision engine, and executes a multi-step CALL-E phone interaction. It extracts structured resolutions, enforces strict safety boundaries (no PII/financial data collection), and routes actionable outcomes back to business systems.

## When to Use This Skill
Use this skill when an AI agent needs to:
- Recover revenue from failed payments or expired cards.
- Follow up on high-value operational exceptions (e.g., supply chain delays, no-shows).
- Execute a phone call that requires strict adherence to safety, consent, and structured data extraction.

## Prerequisites & Setup
1. **CALL-E CLI**: Must be installed and authenticated (`npm install -g @call-e/cli` + `calle auth login`).
2. **Environment**: Set `CALL_E_DRY_RUN=true` in your `.env` file to test the workflow safely without placing live calls or burning credits.
3. **Dependencies**: Ensure the host environment has access to the `@call-e/cli` or the reference Python/Node.js backend implementation.

## Input Payload Schema
The skill expects a structured trigger payload (e.g., from a webhook). Example:
```json
{
  "customer_id": "cus_demo_123456",
  "customer_phone": "+15551234567",
  "trigger_id": "evt_stripe_failed_987",
  "amount": 249.00,
  "failure_reason": "expired_card",
  "is_disputed": false,
  "timestamp": "2026-09-09T14:30:00Z"
}
```

## ⚠️ Strict Safety & Compliance Boundaries
This skill enforces enterprise-grade safety constraints. The AI agent **MUST** adhere to these rules:
1. **NO PCI/PII Collection**: The agent is strictly forbidden from asking for, accepting, or repeating credit card numbers, CVVs, passwords, or SSNs. Users must be directed to secure email links or official portals.
2. **Idempotency**: Every call attempt must use a unique idempotency key (e.g., SHA-256 hash of `customer_id` + `trigger_id` + `attempt_number`) to guarantee a customer is never called twice for the same invoice.
3. **Quiet Hours Guard**: Do not initiate calls outside of 08:00 - 21:00 local time. Queue for the next business day.
4. **Dispute Routing**: If `is_disputed` is `true`, bypass the phone system entirely and route to a human/Zendesk to avoid antagonizing the customer.
5. **Fail-Closed Ambiguity**: If a call outcome is `unknown` or `failed`, do not blindly retry. Flag the record for human reconciliation.

## Execution Workflow
When triggered, the agent should follow this sequence:
1. **Evaluate**: Run the input payload through the Decision Engine (check amount > $50, not disputed, within quiet hours).
2. **Plan**: If approved, invoke the CALL-E `plan_call` tool with a dynamic, safety-gated goal.
3. **Execute**: Upon receiving a `confirm_token`, invoke `run_call`.
4. **Poll**: Use `get_call_run` to poll for the terminal status (`COMPLETED`, `NO ANSWER`, `FAILED`, `DECLINED`).
5. **Extract & Route**: Parse the structured JSON result and trigger the appropriate downstream action (e.g., update CRM, schedule retry, or escalate).

## Expected Structured Result (`resultSchema`)
The CALL-E execution is enforced to return strictly typed JSON, enabling reliable downstream write-backs:
```json
{
  "outcome": {
    "type": "string",
    "enum": ["payment_promised", "disputed", "no_answer", "voicemail", "callback_requested"]
  },
  "promised_date": { "type": "string", "format": "date", "description": "YYYY-MM-DD if applicable" },
  "dispute_reason": { "type": "string", "description": "Reason if outcome is disputed" },
  "escalation_required": { "type": "boolean" },
  "notes": { "type": "string", "description": "Brief summary of the conversation or failure reason" }
}
```

## Downstream Actions
- **If `outcome == "payment_promised"`**: Update CRM status to "Recovery in Progress" and schedule a follow-up check on `promised_date`.
- **If `outcome == "disputed"`**: Create a support ticket (e.g., Zendesk) and flag the customer record for human review.
- **If `outcome == "no_answer"`**: Schedule an automated retry in 2 hours. After 3 failed attempts, set `escalation_required: true`.

## Testing & Dry-Run Mode
To test the complete logic flow **without burning live CALL-E credits or making real phone calls**:
1. Ensure `CALL_E_DRY_RUN=true` is set in the environment.
2. Trigger the skill with the example payload above.
3. The execution engine will intercept the CLI invocation and return a realistic, schema-compliant mock response (`outcome: "payment_promised"`), allowing the agent to verify the end-to-end loop instantly.

## References
- [Safety & Consent Guidelines](references/safety.md)
- [Structured Result Schema Definition](references/schema.json)
- [Main Documentation](README.md)

