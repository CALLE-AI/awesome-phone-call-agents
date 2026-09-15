# MoboFarmer & CALL-E: The Voice-Powered Engine for African Agriculture

## The Problem: The Invisible Cost of Smallholder Farming
For smallholder farmers in South Africa and across the continent, logistics and communication are massive bottlenecks. A farmer looking for input supplies (like seed, fertilizer, or diesel) or trying to find market prices can spend an entire morning calling 5 to 10 different cooperatives, buyers, or municipal offices. 

This manual process costs precious time, airtime, and often requires expensive taxi rides to physically verify stock or negotiate deals. Market access is the #1 hurdle to profitability.

## The Solution: MoboFarmer
MoboFarmer is a comprehensive digital dashboard built specifically for African smallholder farmers. It provides crop inventory tracking, water allocation management, and farm-level analytics. 

But a dashboard alone doesn't solve the core communication bottleneck. **That's where CALL-E becomes the engine of the application.**

## CALL-E: The Autonomous Communication Engine
MoboFarmer integrates autonomous voice AI agents via the **CALL-E** SDK to do the heavy lifting. Instead of the farmer spending 3 hours on the phone, they type:
> "Need 50 bags of L33 maize seed near Bothaville, ask for price and delivery."

MoboFarmer dynamically spins up a CALL-E agent tailored with a specific Skill (Prompt + JSON Extraction Schema) to execute the task autonomously.

### The 3 Core Agents - Most Practical Use Case

#### 1. The Input Sourcing Agent
**Task:** Calls agri co-ops (e.g., Afgri, OVK, NTK) to check stock, pricing, delivery.
**Extraction:**
```json
{ "item_available": "boolean", "price_per_bag": "number", "stock_quantity": "number", "next_delivery_date": "string", "alternative_product": "string" }
```
**Value:** Returns `R875/bag, 60 in stock, Wed delivery` straight to dashboard.

#### 2. The Market Linker Agent
**Task:** Calls fresh produce markets / local buyers.
**Extraction:** `buyer_name, produce_grade_accepted, price_per_kg, pickup_needed, payment_terms_days`
**Value:** Real-time market data before loading the truck. Commercial model: charge buyer for qualified leads.

#### 3. The Water & Service Coordinator Agent
**Task:** Calls Water User Association, vets, transporters.
**Extraction:** `confirmed: boolean, time: datetime, cost: number`

## Why Phone Calls
Co-ops hold live inventory that is stale online. Farmers repeat same details across calls and reconcile manually. CALL-E normalizes it into structured quotes.

## Architecture: Async Polling
1. Next.js backend builds prompt from farmer intent
2. `calleClient.calls.create()` launches call on CALL-E network
3. Frontend polls `/api/calls/status/[requestId]/[callId]` until complete - avoids serverless timeout
4. JSON + transcript persisted to Firebase Firestore

```ts
// apps/typescript/mobo-farmer/app/api/calls/execute/route.ts
const call = await calle.calls.createAndWait({
  goal: `Check L33 maize seed availability`,
  phone_numbers: ["+27XXXXXXXXX"], // masked - real numbers in allowlist on server only
  extraction_schema: {
    item_available: "boolean",
    price_per_bag: "number",
    stock_quantity: "number"
  }
})
```

## Quickstart
```bash
cd apps/typescript/mobo-farmer
cp .env.example .env.local
# CALL_E_API_KEY=...
# CALL_E_FROM_NUMBER=+27XXXXXXXXX
npm install
npm run demo  # dry-run fixture, no real call
npm run demo -- --live # live call, requires explicit approval
```

## Safety, Consent & Side Effects
- **Masked numbers:** All docs use `+27XXXXXXXXX`, real numbers in server allowlist only
- **No secrets:** `.env.example` only, no keys committed
- **Dry-run default:** Deterministic fixture, no dialing until `--live` + human approval
- **Human-owned side effects:** No auto-purchase/dispatch, only information gathering
- **Consent:** Attest recipient consented, respects calling window
- **Cancellation:** Polling loop can be aborted, call can be cancelled via API

## File Structure
```
app/api/calls/plan -> builds prompt + extraction schema
app/api/calls/execute -> create CALL-E call
app/api/calls/status -> polling
app/history -> audit ledger with transcript + JSON
```

## Demo
- Devpost: https://devpost.com/software/mobofarmer
- Video: https://youtu.be/LHBeKtQxibA
- Live: https://mobofarmer.vercel.app

Tested live CALL-E call to test hotline `+1276XXXXXXX`, 33s, transcript + summary returned.

## What it doesn't do
Does not auto-buy seed, does not place orders without farmer confirmation. Information-only.
