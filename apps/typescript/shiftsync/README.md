# ShiftSync — Autonomous Last-Minute Staffing Agent

> **The autonomous last-minute staffing agent powered by CALL-E.**

ShiftSync helps businesses fill urgent staff shortages by autonomously calling qualified employees in sequence until confirmed coverage is secured.

Built for the **CALL-E: Your Code Is Calling** Hackathon under `apps/typescript/shiftsync`.

---

## 1. Problem

When an employee calls in sick 2 hours before an evening rush, managers are forced to stop operating the floor and manually dial through staff rosters one by one:
* Dialing candidate 1 → voicemail.
* Dialing candidate 2 → declined.
* Dialing candidate 3 → offers to come 1 hour late.
* Dialing candidate 4 → accepted.

This frantic phone chase wastes 30–60 minutes of critical management time, risks double-booking shifts, and creates immense operational chaos.

---

## 2. Solution: Autonomous Sequential Phone Orchestration

ShiftSync turns that entire phone chase into an autonomous, goal-driven workflow:
1. The manager inputs the shift details (Role, Date, Hours, Location, Workers Needed).
2. ShiftSync filters qualified staff by role and priority.
3. ShiftSync dials employees sequentially using the **CALL-E Voice Runtime**.
4. The agent introduces itself with transparent AI disclosure, presents the shift details, and listens to the natural response.
5. Conversational nuances (such as conditional late arrival, declines, or acceptance) are mapped to validated structured results.
6. As soon as confirmed coverage is found, **ShiftSync stops immediately**, preventing double-booking and wasted calls.
7. Ambiguous or conditional responses (e.g. *"I can come, but not until 7 PM"*) are surfaced to the manager for one-click review.

---

## 3. How It Works

```text
MANAGER
   │ (Role, Date, Hours, Location)
   ▼
SHIFTSYNC ENGINE
   │ Filters eligible roster by role & priority
   ▼
[ Sequential Dialing Loop ]
   │
   ├─► DIAL CANDIDATE #1 via CALL-E ──► Declined ──► Call next candidate
   │
   ├─► DIAL CANDIDATE #2 via CALL-E ──► No Answer ─► Call next candidate
   │
   └─► DIAL CANDIDATE #3 via CALL-E ──► Accepted!
                                           │
                                           ▼
                                    STOP WORKFLOW
                                           │
                                           ▼
                                    COVERAGE SECURED
```

---

## 4. CALL-E Integration Details

ShiftSync integrates directly with the official **CALL-E Developer API** (`https://api.heycall-e.com/v1/calls`):

* **API Authentication**: Authenticates via `Authorization: Bearer <CALL_E_API_KEY>`.
* **Prompt Engineering**: Instructs CALL-E with strict boundary controls:
  - Transparent AI identification (*"This is ShiftSync, the automated scheduling assistant calling from The Copper Bistro"*).
  - Clear explanation of role, date, shift window, and location.
  - Safe boundary instructions: never promise unauthorized overtime/wages, never collect financial or sensitive personal details.
* **Structured Result Schema**: Injects a strict JSON Schema into `result_schema`:
  ```json
  {
    "type": "object",
    "required": ["status", "employee_name", "shift_date", "notes", "manager_review_required"],
    "properties": {
      "status": {
        "type": "string",
        "enum": ["accepted", "declined", "conditional", "no_answer", "voicemail", "callback_requested", "invalid_number"]
      },
      "employee_name": { "type": "string" },
      "shift_date": { "type": "string" },
      "available_from": { "type": "string" },
      "notes": { "type": "string" },
      "manager_review_required": { "type": "boolean" }
    }
  }
  ```
* **Idempotency Protection**: Every dial carries a unique header `Idempotency-Key: shiftsync_<requestId>_<employeeId>_<attempt>` to prevent duplicate calls during retries or network blips.
* **Lifecycle Polling & Transcript Extraction**: Polls `GET /v1/calls/{call_id}` until terminal status (`completed`, `failed`), extracting turn-by-turn verbatim dialog into the operator timeline.

---

## 5. Quick Start & Running Locally

### Prerequisites
- Node.js 18+ (tested on Node 24)
- npm or pnpm
- CALL-E Developer API Key (from [heycall-e.com](https://heycall-e.com))

### 1. Clone & Install
```bash
git clone https://github.com/CALLE-AI/awesome-phone-call-agents.git
cd awesome-phone-call-agents/apps/typescript/shiftsync # or standalone workspace
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Add your CALL-E API key:
```env
CALL_E_API_KEY=your_calle_api_key_here
CALL_E_BASE_URL=https://api.heycall-e.com
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. Live Testing & Demo Mode

### Real CALL-E Phone Calls (Live Mode)
1. In the header, click **👥 Staff Pool**.
2. Update the phone number for the top candidate (e.g. *Alex* or *James*) to your own phone number in canonical E.164 format (e.g. `+1XXXXXXXXXX`).
3. Set the mode to **🔴 Live CALL-E Dialing**.
4. Click **Find Coverage**.
5. Answer your ringing phone. Speak to ShiftSync:
   - Say *"Yes, I can cover that shift!"* → Watch ShiftSync immediately confirm coverage and stop calling.
   - Say *"I can come, but I can't make it until 7 PM"* → Watch ShiftSync flag a **⚠️ Conditional Coverage** card requiring manager approval.
   - Say *"Sorry, I have plans tonight"* → Watch ShiftSync log the decline and immediately dial the next employee.

### Demo Simulation Mode (Offline / Dry-Run)
Toggle to **🧪 Demo Simulation** to test the entire cascade (Alex declines → David does not answer → James accepts) without consuming live telephony credits.

---

## 7. Safety & Compliance Rules

* **AI Disclosure**: ShiftSync always identifies itself as an automated AI scheduling assistant upon answering.
* **Zero Sensitive Data**: The voice agent never solicits passwords, banking, medical, or government identification details.
* **Zero Unauthorized Commitments**: The agent cannot modify wages, grant overtime, or change official permanent schedules without explicit human manager review.
* **No Harassment**: If an employee declines or asks not to be called, the agent thanks them, immediately disconnects, and does not re-dial.
* **Human-in-the-Loop**: All conditional offers (e.g. late arrival) pause the workflow for explicit manager acceptance.

---

## 8. License

MIT License. Built for the CALL-E Hackathon 2026.
