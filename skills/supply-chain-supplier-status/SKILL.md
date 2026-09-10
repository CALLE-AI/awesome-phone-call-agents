---
name: supply-chain-supplier-status
description: Outbound phone agent powered by CALL-E that calls suppliers to check fulfillment status on purchase orders, negotiates revised dates, captures delay root causes, and generates structured procurement intelligence.
---

# Supply Chain Supplier Status Check

## Purpose And When To Use

Use this skill when an enterprise procurement or supply chain operations team needs to verify upcoming purchase order fulfillment with authorized suppliers, detect delivery slippages before factory or warehouse stockouts occur, and capture structured delay intelligence.

The agent initiates autonomous outbound telephone calls using the CALL-E SDK or API, conducts a deterministic five-step inquiry, and produces structured JSON and CSV reports.

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

## Five-Step Conversational Protocol

The agent follows a deterministic five-step conversational tree:

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

## Input Parameters

Before initiating a call, ensure the following fields are provided:

- `supplier_id`: Unique identifier for the vendor (e.g., `SUP-101`)
- `supplier_name`: Commercial legal entity name
- `phone_number`: Authorized E.164 phone number (e.g., `+15550149923`)
- `purchase_order_id`: Associated active purchase order identifier
- `scheduled_delivery_date`: Committed fulfillment deadline
- `company_name`: Disclosed enterprise caller identity

## Output Schema

The skill outputs a structured result:

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
  "escalation_contact_phone": "+1-555-014-9923",
  "requires_escalation": true
}
```

See [references/safety.md](references/safety.md) for compliance, consent, and data handling boundaries.
See [references/examples.md](references/examples.md) for realistic call scenarios, transcript samples, and report outputs.
