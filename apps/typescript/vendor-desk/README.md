# VendorDesk — Autonomous Procurement Agent

**A CALL-E-powered agent that phones local suppliers, negotiates a quote, and hands you a live price comparison.**

Built for the CALL-E "Your Code Is Calling" hackathon.

## What it does

Give VendorDesk an item and a quantity. It calls every vendor on your list **in parallel** via CALL-E, has a real conversation (stock check → price → alternatives → delivery → rep name), and streams the structured results into a live dashboard so you can see who has it and who's cheapest.

## Side effects — read before running

- **By default, this app makes no real phone calls.** `CALLE_DRY_RUN=true` (the default) logs what it *would* dial and immediately marks the job complete with no live call placed and no cost incurred. Nobody's phone rings in this mode.
- Setting `CALLE_DRY_RUN=false` places **real outbound phone calls** through your CALL-E account and will incur CALL-E usage costs. Only do this with numbers you're authorized to call.
- No recurring jobs or scheduled calls of any kind — every dispatch is a single, one-off batch of calls. There is nothing to cancel or roll back after the fact; once a live call is placed, it runs to completion or failure like any phone call.
- No credentials are logged. Phone numbers are masked in dry-run console output (e.g. `+155***4567`).

## Architecture

```
                     ┌─────────────────────┐
   Buyer submits     │   Next.js Dashboard  │
   item + vendors ──▶│  (live quote table)  │
                     └──────────┬───────────┘
                                │ POST /api/calls/dispatch
                                ▼
                     ┌─────────────────────┐
                     │  Express Backend     │
                     │  - job store (JSON)  │
                     │  - dry-run guard     │
                     └──────────┬───────────┘
                                │ POST /v1/calls (skipped entirely in dry-run)
                                ▼
                     ┌─────────────────────┐
                     │      CALL-E          │
                     │  dials, converses,   │
                     │  extracts structured │
                     │  quote data          │
                     └──────────┬───────────┘
                                │ POST /calle/webhook (terminal result)
                                ▼
                     ┌─────────────────────┐
                     │ /api/calle-webhook   │
                     │ updates job → SSE    │
                     └──────────┬───────────┘
                                │ Server-Sent Events
                                ▼
                     Dashboard updates live, no polling
```

## Setup

### 1. Backend

```bash
cd apps/typescript/vendor-desk
npm install
cp .env.example .env
```

By default `.env` has `CALLE_DRY_RUN=true`, so you can run and try the app immediately with **no CALL-E account required** — skip straight to step 3.

```bash
npm run dev
```

### 2. (Optional) Enable live calls

Only do this once you're ready to place real calls:

1. Follow the [CALL-E installation guide](https://github.com/CALLE-AI/call-e-integrations) and get an API key.
2. In `.env`, set `CALLE_API_KEY` to your key and `CALLE_DRY_RUN=false`.
3. Expose your local webhook publicly (e.g. `ngrok http 3001`) and set `PUBLIC_WEBHOOK_BASE_URL` to that URL.
4. Restart the backend.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3002`, click **Start Sourcing Run**, add an item and a vendor entry, and submit.

## Manual verification path

With the default dry-run settings:

1. Start the backend and frontend as above (no CALL-E account needed).
2. Submit a sourcing run with a fictional vendor, e.g. name `Test Vendor`, phone `+15555550100` (reserved sample number, never a real line).
3. Confirm the backend logs a `[DRY RUN]` line showing the masked number, and the dashboard shows that job as `completed` within a second or two, with no real call placed.

This confirms the dispatch → job store → dashboard pipeline works end-to-end without needing live credentials.

## Sample webhook payload (live mode only)

CALL-E POSTs an event envelope to `/api/calle-webhook` when a live call reaches a terminal state:

```json
{
  "id": "evt_example00000000000000",
  "type": "call.completed",
  "data": {
    "id": "call_example00000000000000",
    "status": "completed",
    "structured_result": {
      "in_stock": true,
      "unit_price": 145.0,
      "alternative_offered": "IBR corrugated sheets",
      "delivery_available": true,
      "representative_name": "Sample Rep"
    },
    "metadata": { "job_id": "abc123", "vendor_name": "Test Vendor", "item": "12x12 corrugated roofing sheets" }
  }
}
```

## Tech stack

Node.js, TypeScript, Express (backend) · Next.js, Tailwind, lucide-react (frontend) · CALL-E REST API for outbound calling (live mode only).
