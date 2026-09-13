---
name: quotehunter
description: Autonomous voice AI agent skill that dispatches parallel phone calls to local service providers via CALL-E, negotiates competitive trade quotes, extracts structured pricing and availability schemas, and generates comparison dossiers for human closing.
license: MIT
---

# QuoteHunter — Parallel Voice Quote Hunter

## Overview

`quotehunter` is an autonomous phone execution skill for CALL-E designed to solve the offline price discovery problem for home maintenance and trade contracting. Instead of a homeowner or procurement officer manually calling 5 to 10 local contractors over several hours, this skill dispatches concurrent AI voice agents in parallel, negotiates estimates in natural conversational speech, extracts verified structured JSON payloads, and compiles an executive comparison matrix for final human decision-making.

## Supported Trade Categories

| Category | Typical Scope Examples | Key Extraction Fields |
| :--- | :--- | :--- |
| **Painting** | Interior 2BHK wall repainting, exterior waterproofing | Paint brand inclusion, primer coats, labor sum |
| **Plumbing** | Kitchen pipe relocation, bathroom sanitary fixture installs | Visit fee, per-point plumbing rate, pipe material |
| **Electrical** | Full house rewiring, MCB trip diagnostics, EV charger setup | Per-point wiring cost, copper gauge, load inspection |
| **HVAC / AC Repair** | Split AC deep gas refill, PCB repair, compressor overhaul | Gas charging rate, warranty duration, visit fee |
| **Catering** | Corporate lunch for 50 pax, wedding buffet per-plate | Per-plate pricing, live counter inclusions, staff cost |
| **Moving & Logistics** | 2BHK interstate household goods packing & transit | Vehicle type, packing labor, insurance coverage |

## Required Call Inputs

| Input Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `service_category` | String | Trade category of the requested job | `"painting"` |
| `job_description` | String | Detailed scope, measurements, and requirements | `"2BHK 950 sq ft interior repaint with primer"` |
| `location` | String | Target neighborhood, city, and state | `"Indiranagar, Bengaluru"` |
| `language` | String | Preferred spoken conversational dialect | `"English"` or `"Hindi"` |
| `vendors` | Array | 2 to 5 targeted local contractors with names & phone numbers | `[{"name": "Apex Painters", "phone": "+15550100"}]` |
| `budget_cap` | Number (optional) | Maximum authorized target budget ceiling | `12000` |
| `currency` | String | Standard ISO or local currency symbol | `"INR"` |

## Conversational Strategy & Contractor Dialog Tree

Contractors frequently work on active job sites and have zero tolerance for robotic or rigid phone trees. QuoteHunter enforces a human-like, conversational dialog strategy:

### 1. Opening Line (Opportunity First, Immediate AI Disclosure)
The agent opens by immediately communicating business opportunity before disclosing its AI identity:
> *"Hi! I'm calling about a painting job for a client in your area. I'm an automated assistant gathering quick estimates — do you have a quick minute for a ballpark quote?"*

### 2. Conversational Slot Extraction
Rather than interrogating the provider linearly, the agent dynamically fills structured slots in whatever natural order the provider shares information:
- **Price Total**: Inquires about total cost, separating labor from material supplies.
- **Availability & Turnaround**: Asks when the contractor can earliest inspect or start, and estimated project completion days.
- **Terms & Hidden Fees**: Verifies whether site visits, material hauling, or cleanup are included or billed separately.
- **Single Polite Flexibility Check**:
  > *"Is that your best quote, or is there any flexibility on that estimate?"*
  The agent asks this exactly once, politely, and gracefully accepts the provider's response without arguing.

### 3. Handling Real-World Contractor Objections

| Contractor Response | AI Agent Strategy | Exact Agent Script |
| :--- | :--- | :--- |
| *"Send details on WhatsApp"* | Agree immediately while asking for rough range to keep provider prioritized | *"Happy to text details right after! Could you give a rough ballpark range first so I can put you at the top of the client's list?"* |
| *"I need to inspect the site first"* | Acknowledge standard practice and confirm inspection charges | *"Totally understand! Do you charge an inspection/visit fee, or is the on-site estimate free?"* |
| *"Who is this / what company?"* | Reassure zero commercial fees or middleman commissions | *"I'm an AI assistant helping a local homeowner compare quotes. No fees or platform commissions."* |
| Immediate price given | Acknowledge instantly and advance to remaining slots | *"Got it, ₹9,500 total. How soon could your team start the work?"* |

### 4. Professional Closing
> *"Thank you so much for the details. I've noted this down for the customer, and they'll reach out directly to confirm next steps. Have a great day!"*

## Technical Architecture & CALL-E Integration

QuoteHunter coordinates concurrent calls through the CALL-E REST API with idempotency tracking and real-time Server-Sent Events (SSE).

### 1. Parallel Dispatch with Idempotency
Each target vendor is dispatched concurrently using isolated `Idempotency-Key` headers (`qh_<jobId>_<vendorId>`) to prevent duplicate telecom dials:

```typescript
import { getRecipientResultSchema } from './schemas/quote-schemas.js';

const resultSchema = getRecipientResultSchema(job.category);

const callPromises = job.vendors.map(async (vendor) => {
  const idempotencyKey = `qh_${job.id}_${vendor.id}`;
  
  const response = await fetch('https://api.heycall-e.com/v1/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CALLE_API_KEY}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      task: generateSystemPrompt(job, vendor),
      recipients: [{ phones: [vendor.phone] }],
      result_schema: resultSchema,
      metadata: {
        job_id: job.id,
        vendor_id: vendor.id,
        category: job.category,
      },
    }),
  });
  return response.json();
});

const dispatchedCalls = await Promise.allSettled(callPromises);
```

### 2. Live Telecom Lifecycle Streaming
During execution, QuoteHunter tracks call state progression across five granular lifecycle phases streamed to the operator UI:
1. `Provisioning 🤖`: Voice AI agent and session synthesized.
2. `Connecting Carrier 📞`: PSTN telecom trunk connected and recipient number dialed.
3. `Ringing 🔔`: Provider telephone actively ringing.
4. `In-Call 🎙️`: Full-duplex conversational turn-taking with contractor.
5. `Extracting Quote 📊`: Structured JSON schema extraction from call audio and transcript.

## Structured Output Contract

Calls return a schema-validated result object enforcing concrete numerical pricing, explicit quote status, and verbatim conversational evidence:

```json
{
  "quote_provided": "yes",
  "price_estimate": "₹9,500",
  "price_numeric": 9500,
  "availability": "Starts this Thursday, 2 days turnaround",
  "additional_conditions": "Asian Paints Royale included; ₹500 cleanup fee waived",
  "provider_notes": "₹7,000 labor + ₹2,500 paint materials with 1-year dampness warranty.",
  "evidence": "\"I can do the full 2BHK for ₹9,500 including Asian Paints materials and wrap up by Friday.\""
}
```

### Formatted Comparison Matrix Output
When all vendor calls conclude, QuoteHunter renders an executive comparison dossier:

| Vendor | Phone | Quote Status | Estimated Price | Earliest Start | Verification Proof |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Apex Home Finishers** 🏆 | `+1-555-0100` | ✅ Provided | **₹9,500** *(Lowest)* | Thursday | *"Full 2BHK for ₹9,500 with Asian Paints"* |
| **Urban Shield Painters** | `+1-555-0101` | ✅ Provided | ₹11,200 | Monday | *"Can do ₹11,200 all inclusive"* |
| **Rapid Touch Paints** | `+1-555-0102` | ❌ Declined | Not Provided | N/A | *"Currently fully booked for the month"* |

## Fail-Closed & Zero-Fabrication Design

- **Unanswered & Busy Calls**: If a provider does not pick up, the call disconnects after 0 seconds, or the carrier reports `failed`/`no-answer`, the outcome is strictly marked `status: "no-answer"` with `price_estimate: "not_provided"`.
- **Refused Quotes**: If a provider refuses to give a price estimate without inspecting, `quote_provided` is set to `"no"`.
- **Zero Hallucination**: QuoteHunter never infers, estimates, or hallucinates numerical prices. If no unambiguous number was spoken by the vendor, `price_numeric` defaults to `0`.

## Human-in-the-Loop Decision Authority

- **Information Discovery Only**: The AI agent is strictly authorized to inquire and discover estimates. It has zero authority to enter into binding agreements, approve work orders, or execute financial transactions.
- **Pre-Flight Operator Confirmation**: Real-world phone calls are never initiated automatically. The operator reviews numbers, requirements, and prompts in a pre-flight modal with a 3-second cancellation buffer.
- **Human Closing**: Final vendor selection and contract booking require direct operator contact via direct dial or messaging.

## Safety & Boundaries

Read `references/safety.md` for full live-call safety rules and privacy guarantees.
Read `references/examples.md` for safe/unsafe operational patterns and representative conversation logs.
