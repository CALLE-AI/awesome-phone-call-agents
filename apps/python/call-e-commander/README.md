# CALL-E Commander: Outbound Call Dispatch & Audit Prototype

CALL-E Commander is a Python/FastAPI backend and React frontend application designed to manage, authorize, and audit phone-call tasks before they are dispatched to the CALL-E API.

This application acts as a governance prototype for hackathon demonstration, ensuring that AI-driven calls require Human-in-the-Loop (HITL) approval, are audited, and execute securely via the CALL-E integration.

## Setup

1. **Backend Configuration:**
   - Requires Python 3.10+
   - Set the `CALLE_API_KEY` environment variable with your CALL-E API key.
   - Run `pip install -r requirements.txt` (or equivalent) in the `apps/python/` directory.
   - Run the FastAPI server: `uvicorn server:app --reload`

2. **Frontend Configuration:**
   - Navigate to `apps/web/`
   - Create a `.env` file containing your Firebase Config.
   - Run `npm install` followed by `npm run dev`

## Side Effects

- **Outbound Calls:** When an administrator approves a Call Plan in the web dashboard, this application makes a `POST /v1/calls` HTTP request to the `api.heycall-e.com` endpoint, which initiates a real outbound phone call via CALL-E.
- **Audit Logging:** Every state change (Creation, Approval, Dispatch, Scrubbing) is written to an Audit DB.

## Credential Handling

- **API Keys:** The CALL-E API key is strictly loaded from the backend environment (`os.environ["CALLE_API_KEY"]`) and is **never** exposed to the React frontend.
- **Admin Identity:** Administrators authenticate using Firebase Auth with origin validation. The backend verifies JWT tokens to ensure only authorized personnel with clinical admin roles can approve or dispatch calls.
- **Data Scrubbing:** Patient Phone numbers (E.164) are encrypted in memory prior to dispatch and zeroed out (PHI-scrubbed) immediately after dispatching to CALL-E.

## Provider Failure Semantics & Dry-run Mode

- **Failure Semantics:** If a network request times out or the provider API fails, the execution returns `status: "failed"` and `task_completed: False`. Network or API failures are **never** fabricated as completed or reschedule-confirmed, preventing false clinical states.
- **Offline Mock Mode:** Offline dry-run simulation is enabled only when `CALLE_MOCK_MODE=1` is explicitly set for local UI development and testing.
- **Approval Gate:** No call is ever executed automatically. Every event is generated as `PENDING_APPROVAL` and requires explicit user action to preview the script and click "Approve & Dispatch".

## Cancellation Behavior & Guarantees

- **Pre-dispatch Cancellation:** Supported via `POST /api/plans/{plan_id}/dismiss`. Dismissing a plan before dispatch guarantees the plan is marked `DISMISSED` and the CALL-E API is never contacted.
- **In-flight Cancellation:** If a call has already been dispatched, the system sends a best-effort cancellation request via `CalleClient.calls_cancel` to the remote API. In-flight cancellation relies on telephony network propagation and is not guaranteed to terminate an active call synchronously.

