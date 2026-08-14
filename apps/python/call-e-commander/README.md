# CALL-E Commander: Enterprise-Grade Dispatch & Audit Platform

CALL-E Commander is a Python/FastAPI backend and React frontend application designed to securely manage, authorize, and audit phone-call tasks before they are dispatched to the CALL-E API.

This application acts as an enterprise governance layer, ensuring that all AI-driven calls require Human-in-the-Loop (HITL) approval, are fully audited, and execute securely via the CALL-E integration.

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
- **Audit Logging:** Every state change (Creation, Approval, Dispatch, Scrubbing) is written to an in-memory Audit DB (or a persistent DB if configured).

## Credential Handling

- **API Keys:** The CALL-E API key is strictly loaded from the backend environment (`os.environ["CALLE_API_KEY"]`) and is **never** exposed to the React frontend.
- **Admin Identity:** Administrators authenticate using Firebase Auth. The backend verifies the JWT tokens via `firebase-admin` to ensure only authorized personnel can dispatch calls.
- **Data Scrubbing:** Patient Phone numbers (E.164) are encrypted in memory prior to dispatch and zeroed out (PHI-scrubbed) immediately after dispatching to CALL-E.

## Dry-run & Preview Behavior

- **Built-in Fallback/Mock Mode:** If the `CALLE_API_KEY` is missing or the network request times out, the `CalleClient` gracefully falls back to local execution. It will simulate a completed call and return a mock structured result (e.g., `reschedule_confirmed: True`) to allow safe offline testing, UI development, and hackathon demos without consuming real CALL-E credits or dialing actual numbers.
- **Approval Gate:** No call is ever executed or simulated automatically. Every event is generated as `PENDING_APPROVAL` and requires explicit user action to preview the script and click "Approve & Dispatch".

## Cancellation

- Cancellation is supported via the backend endpoint `POST /api/plans/{plan_id}/dismiss`.
- If dismissed before dispatch, the plan is marked `DISMISSED` and the CALL-E API is never contacted.
- If the call is already in progress, the system can invoke the `/v1/calls/{call_id}/cancel` endpoint via the `CalleClient.calls_cancel` method to terminate the active CALL-E task.
