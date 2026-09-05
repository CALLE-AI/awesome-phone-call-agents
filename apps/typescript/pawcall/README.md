# PAWCALL

> **"One call can save a life."**

PawCall is an emergency animal rescue coordination application powered by CALL-E AI Voice Dispatch. When an animal in distress is reported, PawCall collects critical incident and GPS details, locates nearby rescue units, and makes an automated real-time outbound AI phone call to a responder.

The AI voice dispatcher explains the emergency, communicates location, and interprets the responder's spoken response into structured data (`yes`, `no`, or `unknown`), updating the live dispatch screen instantly.

---

## 1. Architecture Overview

PawCall follows a full-stack architecture with strict server-side API credential isolation:

```
[ Browser / Client ]
      │
      │ 1. Report Emergency (Animal, Problem, GPS, Phone)
      ▼
[ PawCall Backend (Node.js + Express) ]
      │
      │ 2. Create Rescue Request + Build Structured Dispatch Prompt
      ▼
[ CALL-E Voice API (https://api.heycall-e.com/v1/calls) ]
      │
      │ 3. Automated Outbound Call
      ▼
[ Responder Phone (Tester Phone in Demo Mode) ]
      │
      │ 4. Verbal Response ("Yes, I can help" / "No, I'm unavailable")
      ▼
[ CALL-E Structured Extraction Model ]
      │
      │ 5. Asynchronous Webhook / Status Sync ({ response: "yes" | "no" | "unknown" })
      ▼
[ PawCall Rescue State Machine ]
      │
      │ 6. Real-Time Status Stream (Polling / Webhook)
      ▼
[ PawCall UI (Help Arriving / No Responder / Retry) ]
```

---

## 2. CALL-E Integration Details

### Outbound Call Dispatch
- **Endpoint**: `POST https://api.heycall-e.com/v1/calls`
- **Authentication**: `Authorization: Bearer <CALLE_API_KEY>` (Kept strictly on the backend)
- **Task Prompt**: An emergency dispatcher persona giving animal details, coordinates, and asking if the responder can take the rescue.

### Structured Response Schema
```json
{
  "type": "object",
  "properties": {
    "response": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Affirmative acceptance ('yes'), unavailability/rejection ('no'), or ambiguous/interrupted ('unknown')."
    },
    "notes": {
      "type": "string",
      "description": "Short summary of the responder's spoken reason, ETA, or comments."
    }
  },
  "required": ["response"],
  "additionalProperties": false
}
```

### Webhook Endpoint
- **Endpoint**: `POST /api/calle/webhook`
- Handles terminal events (`call.completed`, `call.failed`, `call.result_validation_failed`) and synchronizes live dispatch state with the in-memory rescue store.

---

## 3. Environment Setup

Create or configure `.env` (refer to `.env.example`):

```bash
# CALL-E API Key from https://heycall-e.com/
CALLE_API_KEY=your_calle_api_key_here

# Enable live CALL-E phone calls (true) or dev simulation (false)
CALLE_ENABLED=true

# Demo mode ensures calls route to tester-entered phone numbers
DEMO_MODE=true

# Public application URL for webhook callbacks
APP_URL=http://localhost:3000

# Server port
PORT=3000
```

---

## 4. Running Locally

```bash
# Install dependencies
npm install

# Start full-stack development server (Express + Vite)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

---

## 5. How to Test a Real Phone Call (Hackathon Demo)

1. Open PawCall in your browser.
2. Click **GET HELP NOW** on the home screen.
3. Select an animal (e.g., **Cow**).
4. Select or describe the distress (e.g., **"Trapped in drain / canal"**).
5. Allow browser Geolocation to capture coordinates.
6. Enter your **real phone number** in E.164 format (e.g., `+919876543210` or `+1XXXXXXXXXX`).
7. Click **START AI RESCUE DISPATCH**.
8. Watch the animated Radar Scanner locate nearby units.
9. Your phone will ring from CALL-E.
10. Answer and listen to the AI Dispatcher.
11. **Acceptance Test**: Speak *"Yes, I can assist."* -> CALL-E returns `yes` -> PawCall displays **HELP IS ARRIVING**.
12. **Decline Test**: In a second run, speak *"No, I'm unavailable."* -> CALL-E returns `no` -> PawCall displays **NO RESPONDER AVAILABLE**.

---

## 6. Modes of Operation

- **Demo Mode (`DEMO_MODE=true`)**: Active by default. Outbound calls are sent to the test phone number entered in the form, preventing accidental contact to actual emergency NGO numbers.
- **Development Mode (`CALLE_ENABLED=false` or missing API key)**: Allows testing the full UI state transitions and radar sweep without consuming CALL-E voice minutes.

---

## 7. State Machine

The central rescue lifecycle enforces 8 discrete states:
1. `scanning`: Locating geo-indexed rescue units
2. `calling`: Initiating outbound CALL-E telephone connection
3. `connected`: Responder answered, AI is speaking
4. `waiting_for_response`: AI listening to human verbal reply
5. `help_confirmed`: Responder clearly agreed (`yes`)
6. `no_responder`: Responder declined (`no`)
7. `unknown_response`: Inaudible, interrupted, or ambiguous (`unknown`)
8. `call_failed`: Telecom error, invalid number, or API failure
