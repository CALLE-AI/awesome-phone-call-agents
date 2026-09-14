# RxScout

An experimental pharmacy-availability workflow with a simulated search and optional CALL-E/SMS integrations. Recommended evaluation is credential-free sandbox only; extracted stock information is advisory and must be confirmed with the pharmacy.

- Repository: [https://github.com/prkshverma09/RxScout](https://github.com/prkshverma09/RxScout)
- License: MIT

RxScout is hosted in its own repository. It is not a CALL-E SDK and does not define a supported application API.

## Overview

Patients managing acute or chronic conditions frequently experience prescription shortages for critical medications. When local stock runs out, patients must manually dial store after store, wait on hold, navigate multi-level IVR phone menus, and repeat dosage queries.

RxScout eliminates this manual burden by orchestrating goal-driven voice calls through CALL-E:
1. **Discovers Local Pharmacies**: Resolves nearby licensed chemists and retail pharmacies within a user-defined radius based on area PIN code.
2. **Autonomous Calling with CALL-E**: Places outbound calls, navigates switchboards, and reaches the dispensary/counter staff.
3. **Structured Stock Extraction**: Parses the conversational exchange into machine-readable JSON: availability (`in_stock: boolean`), quantity/strips, and pharmacist notes.
4. **Sequential search prototype**: The intended flow stops when stock is reported. The live queue can currently advance after a timeout or provider error, so it must not be treated as a zero-spam or unattended-safe caller.
5. **Instant Patient Notification**: Dispatches an SMS alert with store address, contact, distance, and a copyable prescription transfer template.

## Setup

Requirements: Node.js 18+ (tested on Node.js 20 & 22) and npm.

```bash
git clone https://github.com/prkshverma09/RxScout.git
cd RxScout

# Install dependencies
npm install

# Environment setup: keep sandbox mode; do not configure CALL-E or Twilio keys
cp .env.example .env.local

# Run test suite
npm test

# Start development server
npm run dev
```

The web dashboard runs locally on `http://localhost:3000`.

## CALL-E integration method

RxScout interacts with CALL-E using both the CALL-E REST API (`https://api.heycall-e.com/v1`) via `fetch` and the `calle` CLI client via child process execution (`call plan`, `call run`, `call status`).

The application implements:
- `planCall`: Generates structured phone tree navigation instructions and a strict JSON result extraction schema.
- `runCall`: Initiates execution of the approved plan.
- `getCallRun`: Polls active call status, aggregates live transcripts turn-by-turn, and parses extracted outcome payloads.

## Call side effects

In live mode (`NEXT_PUBLIC_APP_MODE=live`), initiating a search sends an outbound call request to CALL-E. This dials a real telephone number and incurs telephony usage.

The external live integration is experimental, not approved here for unattended searches. Polling exhaustion and caught provider errors can advance to another pharmacy despite an ambiguous first outcome. That queue must stop for operator reconciliation before unattended use. Its intended sequential behavior is:
- Calls are dispatched one-by-one, strictly in order of geographic proximity.
- As soon as a pharmacy confirms that the requested medication is in stock, all remaining calls in the queue are cancelled and dialing stops immediately.
- In test mode, RxScout restricts dialing to a single user-specified test phone number.

## Safe testing path with no calls

For review, use **Sandbox Mode** (`NEXT_PUBLIC_APP_MODE=sandbox`) with no CALL-E, Twilio, or other live-service credentials and leave notification recipients unset. Sandbox search simulates calls, but its notifier can still send a real SMS when Twilio credentials and a destination are supplied; sandbox alone is not a universal no-side-effect guarantee.
- Includes a built-in telephone simulator with realistic IVR audio signaling, speech synthesis, and turn-by-turn conversational flow.
- Uses deterministic mock pharmacy networks and shortage presets (Delhi, Bengaluru, Mumbai, Kolkata).
- All 15 automated tests run offline against the simulator and mock fixtures, requiring zero network calls or credentials.

## Credential handling

All API keys (`CALLE_API_KEY`, `GOOGLE_PLACES_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) are loaded from server-side environment variables via `.env.local`. They are never committed, never exposed to client-side bundles, and `.env*.local` is enforced in `.gitignore`.

## Phone-number handling

Documentation, test suites, and sample presets use masked and fictional numbers only (e.g. `+918000000000`, `+919876543210`). Input fields in the public UI start blank without pre-filled personal numbers.

## Boundaries

RxScout is a tool for locating medicine availability at licensed retail pharmacies. It is not an emergency response system, does not dispense or prescribe pharmaceuticals, and does not provide medical advice.
