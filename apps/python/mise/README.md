# MISE

**Minimal Invocation for Supplier Evidence** — a state machine that prevents autonomous agents from declaring real-world work complete based on vague claims.

MISE wraps CALL-E phone calls in a hard operational boundary: a conversation doesn't move the workflow, a verified commitment does. When a critical delivery fails, MISE calls the responsible supplier, extracts a structured commitment, evaluates it against required conditions, and only advances the operational state when every condition is met.

## Why this matters

Autonomous agents increasingly interact with the physical world — calling suppliers, coordinating services, recovering from failures. But conversation creates ambiguity. "We'll try to get it out tomorrow" is not a commitment. MISE exists to draw the line between talk and action.

## Architecture

```
PHONE → COMMITMENT → EVIDENCE → DECISION → STATE CHANGE
```

- **State machine**: `DELIVERY_FAILED → SUPPLIER_CONTACT_REQUIRED → COMMITMENT_ACCEPTED → RECOVERY_COMMITTED`
- **CALL-E integration**: Outbound phone calls via CALL-E API with structured result schemas
- **Commitment extraction**: Parses supplier responses for quantity, action, ship date, deadline, and reference
- **Verification gate**: Rejects hedged, partial, or insufficient commitments with specific reject codes
- **Evidence chain**: Append-only, hash-linked ledger of every state transition and call evidence
- **Security lab**: 4 adversarial attack scenarios that verify the protocol rejects false completions

## Setup

### Backend (Python)

```bash
git clone https://github.com/HillaryIkhais/MISE.git
cd MISE
python3 server.py
```

The server binds to `0.0.0.0:8080` and auto-seeds a Torque Precision incident at `DELIVERY_FAILED` state.

### Frontend (Next.js)

```bash
cd web
npm install
npm run dev
```

Frontend runs at `http://localhost:3000` and proxies API calls to the backend.

### CALL-E Integration (optional)

Create `MISE/.env`:

```
CALLE_BASE_URL=https://api.call-e.com
CALLE_API_KEY=your-api-key
CALLE_PHONE=+1XXXXXXXXXX
```

Without CALL-E credentials, the demo runs in simulation mode (deterministic `simulate_phone()`).

## Usage

1. Open `http://localhost:3000` — landing page with 3D supply chain constellation
2. Click **Open Live Demo** — workspace overview with primary incident card
3. Click the incident card — incident detail page
4. Click **Run Simulation** — watch the call phases animate, transcript appear, commitment extracted, state advance
5. Navigate to **Evidence** — sealed records with hash chain
6. Navigate to **Security Lab** — run 4 attack scenarios, all blocked

## Dry-run / No-call path

Simulation mode is the default. All call phases, transcripts, and commitment extraction work without any CALL-E credentials. The `simulate_phone()` function returns deterministic supplier responses that exercise the full state machine.

Live calling requires valid CALL-E credentials and is opt-in via the "Execute Live Call" button.

## Side effects

- **Simulation**: No external side effects. State transitions are local to the SQLite ledger.
- **Live call**: Places a real outbound phone call via CALL-E. The supplier receives a real conversation. State transitions are recorded in the append-only ledger.

## Cancellation / Rollback

- State transitions are forward-only. Once `COMMITMENT_ACCEPTED`, the state cannot revert.
- The evidence chain is append-only and hash-linked. Tampering is detectable.
- No recurring schedules or repeat calls are created.

## Test suite

- 73 tests passing (state machine, call verification, evidence chain, security lab)
- 5,000 mutation tests evaluated, 0 violations

## Tech stack

- **Backend**: Python 3 (stdlib HTTP server, SQLite)
- **Frontend**: Next.js 16, TypeScript, Tailwind CSS v4, GSAP, Three.js canvas
- **Phone**: CALL-E API integration

## License

MIT
