---
name: supply-chain-supplier-status
description: Outbound phone agent powered by CALL-E that calls suppliers to check fulfillment status on purchase orders, negotiates revised dates, captures delay root causes, and generates structured procurement intelligence.
---

# Supply Chain Supplier Status Check

## Purpose And When To Use

Use this skill when an enterprise procurement or supply chain operations team needs to verify upcoming purchase order fulfillment with authorized suppliers, detect delivery slippages before factory or warehouse stockouts occur, and capture structured delay intelligence.

This is the portable skill specification for [Supply Chain Supplier Status Agent](https://github.com/mohSadiq90/call-e-hackathon), providing the structured conversational inquiry tree, CALL-E API dispatch contract, and procurement intelligence schemas.

Use this skill for:

- proactive order verification calls to authorized vendor dispatchers
- capturing delivery schedule slips and delay root cause categories
- recording revised delivery dates and expedited freight commitments
- quantifying delay penalty exposure and recording supervisor escalation details
- generating structured procurement dashboards and ERP-compatible records

## When Not To Use

Do not use this skill to:

- place unsolicited cold calls to numbers without an established vendor relationship or purchase order reference
- negotiate binding contract amendments, pricing changes, or warranty releases without human authorization
- cancel purchase orders, terminate supplier contracts, or initiate legal action
- record payment credentials, banking details, or sensitive personal data
- initiate unauthorized automated calls outside business hours or without recording consent where required by law
- retry endlessly when a vendor contact declines or requests human follow-up
- any workflow requiring in-flight call cancellation after dispatch (the CALL-E Calls API has no cancel endpoint; keep waves small)

## Required Inputs

Before initiating a call, ensure the following fields are provided:

- `supplier_id`: Unique identifier for the vendor (e.g., `SUP-101`)
- `supplier_name`: Commercial legal entity name
- `phone_number`: Authorized E.164 phone number (`^\+[1-9]\d{6,14}$`, e.g., `+15550149923`)
- `purchase_order_id`: Associated active purchase order identifier (e.g., `PO-88120`)
- `scheduled_delivery_date`: Committed fulfillment deadline (`YYYY-MM-DD`)
- `company_name`: Disclosed enterprise caller identity
- `authorization_confirmed`: Explicit operator confirmation (`true`) that the call and specific recipient are authorized
- `destination_authorized`: Explicit operator attestation (`true`) that the destination phone number matches the supplier's verified dispatch contact on file

## Preflight & Authorization Boundary

Execute these checks prior to dispatching any call:

1. **Operator Authorization:** Refuse to dispatch without `authorization_confirmed: true` and `destination_authorized: true` recorded by the operator. Never infer authorization or dial unverified numbers.
2. **Destination Validation:** Validate every phone number as strict E.164 (`^\+[1-9]\d{6,14}$`). Reject emergency-number patterns, toll-free lines, or unverified destinations.
3. **Credentials:** Require a valid server-side `CALLE_API_KEY`. Without credentials, block live calling and use the zero-credit offline simulation engine.

## Ambiguity Stop & Deduplication Contract

1. **Stop on Ambiguous Submission:** If purchase order identifiers, supplier identities, contact phone numbers, or delivery commitments are ambiguous, incomplete, or conflicting, stop execution immediately. Fail-closed to a human operator review before initiating any telephony action.
2. **Deterministic Idempotency Key:** Derive a deterministic key per call task: `supplier-status:{purchase_order_id}:{supplier_id}:{scheduled_delivery_date}:v1`. Persist the task row with that key before dispatch.
3. **No Automatic Redial on Ambiguity:** If a call submission encounters a network timeout, gateway error, or indeterminate dispatch status, do NOT automatically redial or launch parallel attempts. Hold and route to a human procurement operator for manual verification.

## Cancellation Limits & Boundary

The CALL-E Calls API does not provide an endpoint to cancel, recall, or interrupt an in-flight call once dispatched. Closing the browser tab, exiting the client process, or triggering an application kill switch cannot recall a call that has already reached the telephony carrier network. A kill switch or abort flag only prevents *subsequent* queued or future wave calls from being initiated. Operators must keep verification waves small, review preflight parameters, and confirm operator authorization before launching.

## CALL-E Telephony API Dispatch Contract

This reference describes a direct HTTPS REST integration. For the supported API contract and official Python or TypeScript SDKs, consult the [CALL-E integration documentation](https://github.com/CALLE-AI/call-e-integrations) before adapting these requests:

```http
POST https://api.heycall-e.com/v1/calls
Authorization: Bearer $CALLE_API_KEY
Idempotency-Key: supplier-status:{purchase_order_id}:{supplier_id}:{scheduled_delivery_date}:v1
Content-Type: application/json
```

```json
{
  "task": "<see task prompt template below>",
  "recipients": [{ "phones": ["+15550149923"], "locale": "en-US", "region": "US" }],
  "recipient_result_schema": {
    "type": "object",
    "properties": {
      "fulfillment_status": { "type": "string", "enum": ["ON_TIME", "DELAYED", "PARTIAL_DISPATCH", "UNREACHABLE"] },
      "revised_delivery_date": { "type": "string" },
      "delay_days": { "type": "integer" },
      "delay_reason_category": { "type": "string", "enum": ["NONE", "RAW_MATERIAL_SHORTAGE", "LOGISTICS_PORT_CONGESTION", "QUALITY_CONTROL_HOLD", "EQUIPMENT_BREAKDOWN", "LABOR_SHORTAGE", "OTHER"] },
      "delay_reason_details": { "type": "string" },
      "estimated_financial_exposure_usd": { "type": "number" },
      "escalation_contact_name": { "type": "string" },
      "escalation_contact_phone": { "type": "string" },
      "requires_escalation": { "type": "boolean" }
    },
    "required": ["fulfillment_status", "revised_delivery_date", "delay_days", "delay_reason_category", "requires_escalation"]
  },
  "metadata": {
    "purchase_order_id": "PO-88120",
    "supplier_id": "SUP-102"
  }
}
```

### CALL-E Task Prompt Template

```text
You are an automated procurement assistant calling on behalf of {company_name}.
State in your first sentence that you are an automated assistant calling on a recorded line regarding Purchase Order {purchase_order_id}.
Confirm you are speaking with the dispatch or fulfillment desk at {supplier_name}.

Inquire whether the scheduled delivery of {purchase_order_id} due on {scheduled_delivery_date} is confirmed to arrive on time and in full.
- If confirmed on time: record fulfillment_status as ON_TIME, revised_delivery_date as {scheduled_delivery_date}, delay_days as 0, and close politely.
- If delayed: determine the revised delivery date, calculate delay days, isolate the delay root cause into standard categories (RAW_MATERIAL_SHORTAGE, LOGISTICS_PORT_CONGESTION, QUALITY_CONTROL_HOLD, EQUIPMENT_BREAKDOWN, LABOR_SHORTAGE, OTHER), and inquire about partial dispatch or expedited freight options.
- If delayed: request the escalation contact name and phone number for the plant or shipping supervisor.

Do not agree to binding contract modifications, fee waivers, or pricing adjustments. State that human procurement managers will review any delays.
```

## Five-Step Conversational Protocol

1. **Step 1: Greeting & Identity Verification**
   - Disclose caller identity on behalf of the procuring enterprise.
   - State that the call is placed on a recorded line for order verification.
   - Confirm the recipient is an authorized dispatch or fulfillment representative.

2. **Step 2: Fulfillment Status Check**
   - Reference the specific Purchase Order number, SKU, and scheduled fulfillment date.
   - Inquire whether the shipment will be fulfilled on schedule and in full volume.

3. **Step 3: Root Cause Analysis (If Delayed)**
   - If delayed, isolate the primary cause into standard supply chain categories:
     - `RAW_MATERIAL_SHORTAGE`
     - `LOGISTICS_PORT_CONGESTION`
     - `QUALITY_CONTROL_HOLD`
     - `EQUIPMENT_BREAKDOWN`
     - `LABOR_SHORTAGE`

4. **Step 4: Revised Timeline & Mitigation Negotiation**
   - Collect the revised delivery date.
   - Inquire about partial delivery or expedited air freight options.

5. **Step 5: Financial Assessment & Structured Escalation**
   - Confirm daily delay penalty clause applicability.
   - Capture plant manager or shipping supervisor escalation contact name and phone number.
   - Summarize confirmed points and close the call politely.

## Output Schema & Privacy Masking

The skill outputs a structured result with telephone numbers and provider-specific telemetry masked:

```json
{
  "call_id": "call_mock_SUP-102_1789034",
  "supplier_id": "SUP-102",
  "purchase_order_id": "PO-88120",
  "fulfillment_status": "DELAYED",
  "revised_delivery_date": "2026-09-20",
  "delay_days": 5,
  "delay_reason_category": "RAW_MATERIAL_SHORTAGE",
  "delay_reason_details": "Polymer resin adhesive shipment delayed at regional port.",
  "estimated_financial_exposure_usd": 8350.0,
  "escalation_contact_name": "Maria Gomez",
  "escalation_contact_phone": "+1-555-***-9923",
  "requires_escalation": true
}
```

All telephone numbers displayed in operator dashboards, CLI summaries, and export records must be masked (e.g. `+1-555-***-9923`). Unmasked E.164 numbers are retained strictly within internal procurement databases. Raw provider telemetry and carrier-specific identifiers are stripped from downstream reporting.

## References & Runnable Implementation

- See [references/reference-implementation.md](references/reference-implementation.md) for the runnable reference implementation, local zero-credit simulation engine, interactive operations dashboard, and automated test suite.
- See [references/safety.md](references/safety.md) for compliance, consent, and data handling boundaries.
- See [references/examples.md](references/examples.md) for realistic call scenarios, transcript samples, and report outputs.
