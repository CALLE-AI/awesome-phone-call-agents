# SiteSignal CALL-E

> Voice-first incident coordination for workers without internet/mobile-data access. A functioning telephone voice connection is still required; CALL-E cannot reach a handset in a complete voice-coverage dead zone.

SiteSignal CALL-E is an operator coordination console that closes the loop for offline maintenance workers. When an incident is reported, the operator dispatches CALL-E to call the worker directly. CALL-E collects status, identifies what resource is needed, finds nearby suppliers, and calls the worker back with options. The operator then dispatches a runner to deliver the item — all without the worker needing internet access.

## The problem

Maintenance workers may lack mobile data or access to an internet-based ticketing tool. Where telephone voice service remains available, the operator can arrange a call to collect an update. Workers in elevator shafts, basements, or tunnels without voice coverage must first use another established communication route or reach a covered location.

## What it does

1. **Incident reported** — operator sees the ticket in a live 3D campus map console
2. **CALL-E calls the worker** — outbound call collects status, tool needed, ZIP, and preference (cheapest / nearest / fastest)
3. **Structured result surfaces** — item, location, and supplier options appear instantly on the operator screen
4. **CALL-E calls back** — operator selects a supplier; CALL-E calls the worker with the option details
5. **Runner dispatched** — operator assigns a runner to collect the item from the front desk and deliver to the worker's floor

The worker can receive help without internet or SMS, provided telephone voice service is available.

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

The source link was unavailable during review. This contribution is an external hosted-demo reference, not an independently verified runnable source package. The frontend link above was reachable; its call buttons can have real side effects and should only be used by an authorized operator with the recipient's consent.

## CALL-E usage

- Outbound call to maintenance worker with scenario-specific script
- Structured result schema: `status`, `fixed`, `item`, `zip_code`, `city`, `search_preference`, `next_action`
- Idempotency key per session to support safe retries and demo resets
- Second outbound call back to worker with selected supplier name, distance, and price
- Call screening handled: agent waits for human greeting before delivering script
