# SiteSignal CALL-E

> When a worker has no signal, CALL-E reaches out to them. Voice-first incident coordination for environments where internet and SMS don't reach.

SiteSignal CALL-E is an operator coordination console that closes the loop for offline maintenance workers. When an incident is reported, the operator dispatches CALL-E to call the worker directly. CALL-E collects status, identifies what resource is needed, finds nearby suppliers, and calls the worker back with options. The operator then dispatches a runner to deliver the item — all without the worker needing internet access.

## The problem

Maintenance workers operate in dead zones — elevator shafts, basements, utility tunnels. When something goes wrong they cannot open a ticket, send a message, or search for help. Existing incident management tools assume the worker has connectivity. CALL-E inverts this: the system reaches out to the worker, not the other way around.

## What it does

1. **Incident reported** — operator sees the ticket in a live 3D campus map console
2. **CALL-E calls the worker** — outbound call collects status, tool needed, ZIP, and preference (cheapest / nearest / fastest)
3. **Structured result surfaces** — item, location, and supplier options appear instantly on the operator screen
4. **CALL-E calls back** — operator selects a supplier; CALL-E calls the worker with the option details
5. **Runner dispatched** — operator assigns a runner to collect the item from the front desk and deliver to the worker's floor

The worker gets help with no internet, no SMS, voice only.

## Live demo

**Frontend:** https://sitesignal-call-e-frontend-935116080264.us-central1.run.app

1. Click the phone icon on the incident card to trigger a CALL-E outbound call
2. Answer the call — CALL-E asks about the elevator status and what tool is needed
3. The incident card shows extracted data and supplier options after the call completes
4. Click **Send to worker** to trigger a callback with the selected supplier details
5. Click **Dispatch runner to Floor 4** to complete the coordination loop

## Stack

| Layer | Technology |
|---|---|
| Voice AI | CALL-E API — outbound calls with structured result extraction |
| Backend | Node.js + TypeScript + Fastify |
| Storage | Google Firestore |
| Frontend | React + Three.js (3D campus map) |
| Infrastructure | Google Cloud Run, Secret Manager |

## Source

https://github.com/alexzerg/sitesignal/tree/hackathon/call-e

## CALL-E usage

- Outbound call to maintenance worker with scenario-specific script
- Structured result schema: `status`, `fixed`, `item`, `zip_code`, `city`, `search_preference`, `next_action`
- Idempotency key per session to support safe retries and demo resets
- Second outbound call back to worker with selected supplier name, distance, and price
- Call screening handled: agent waits for human greeting before delivering script
