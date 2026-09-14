# CALL-E Commander: Outbound Call Dispatch & Audit Prototype

CALL-E Commander is a Python/FastAPI backend and React frontend application designed to manage, authorize, and audit phone-call tasks before they are dispatched to the CALL-E API.

This application acts as a governance prototype for hackathon demonstration, ensuring that AI-driven calls require Human-in-the-Loop (HITL) approval, are audited, and execute securely via the CALL-E integration.

## Setup

1. **Backend Configuration:**
   - Requires Python 3.10+
   - From the repository root: `cd apps/python/call-e-commander/backend`
   - Set the `CALLE_API_KEY` environment variable with your CALL-E API key.
   - Run `pip install -r requirements.txt`.
   - Run the FastAPI server with the package importable as `medops_call_commander` (matching the Dockerfile):
     `PYTHONPATH=. uvicorn medops_call_commander.server:app --reload --port 10000`
   - For a fully offline dry run with no network calls at all, set `CALLE_MOCK_MODE=1` first.

2. **Frontend Configuration:**
   - From the repository root: `cd apps/python/call-e-commander/frontend`
   - Create a `.env` file containing your Firebase Config (see `frontend/src/firebase.js` for the expected `VITE_FIREBASE_*` keys).
   - Run `npm install` followed by `npm run dev`.

## Side Effects

- **Outbound Calls:** When an administrator approves a Call Plan in the web dashboard, this application makes a `POST /v1/calls` HTTP request to the `api.heycall-e.com` endpoint, which initiates a real outbound phone call via CALL-E. This request is only ever sent to a host explicitly on the `CALLE_ALLOWED_HOSTS` allowlist (`api.heycall-e.com` by default) — the CALL-E credential is never sent anywhere else.
- **Offline by default for local dev:** Set `CALLE_MOCK_MODE=1` to skip all outbound HTTP calls; this is checked before any network request is made, so no credential is ever transmitted in mock mode.
- **Audit Logging:** Every state change (Creation, Approval, Dispatch, Scrubbing) is written to an Audit DB.

## Credential Handling

- **API Keys:** The CALL-E API key is strictly loaded from the backend environment (`os.environ["CALLE_API_KEY"]`), validated against an allowlisted CALL-E host before use, and is **never** exposed to the React frontend.
- **Admin Identity:** Administrators authenticate using Firebase Auth with `aud`/`iss` origin validation against the configured Firebase project. The backend enforces a bounded clinical-role allowlist (`admin`, `super_admin`, `clinician`) on every sensitive endpoint; a missing or unrecognized role is rejected outright, never defaulted to an authorized role.
- **Auth-bypass / test mode:** `MEDOPS_BYPASS_AUTH` and `MEDOPS_TEST_MODE` are for local development only. Enabling either one automatically forces `CALLE_MOCK_MODE=1` at startup, so a bypassed session can never place a live call or reach a real EHR record — consent is force-granted only against the mocked CALL-E provider.
- **Data Scrubbing:** Patient Phone numbers (E.164) are encrypted in memory prior to dispatch and zeroed out (PHI-scrubbed) immediately after dispatching to CALL-E. Phone numbers are also stripped from any error text returned by the API or written to logs.
- **Destination validation:** `patient_phone` must be a strict ASCII E.164 number (`+` followed by 8-15 digits, no letters, spaces, punctuation, or unicode look-alike digits); malformed input is rejected before any agent or provider logic runs.

## Provider Failure Semantics & Dry-run Mode

- **Confirmed failure vs. unresolved:** A call is only recorded as `FAILED` when CALL-E itself reports a definite failure (a real HTTP error response). A network or read error while dispatching or polling does **not** prove the phone call failed — CALL-E may have accepted or completed it while we simply could not confirm the result. Those cases are tracked as an unresolved/unknown outcome, and only marked `FAILED` locally after the polling window is exhausted with no confirmed result — at which point the audit entry and API response both say the outcome is unresolved, not confirmed failed, and direct the operator to check the CALL-E dashboard.
- **Offline Mock Mode:** Set `CALLE_MOCK_MODE=1` to skip outbound HTTP entirely for local UI development and testing; this check happens before any request is constructed.
- **Approval Gate:** No call is ever executed automatically. Every event is generated as `PENDING_APPROVAL` and requires explicit user action to preview the script and click "Approve & Dispatch".

## Cancellation Behavior & Guarantees

- **Pre-dispatch Cancellation:** Supported via `POST /api/plans/{plan_id}/dismiss`, but only while the plan is still `CREATED`/`QUEUED`/`PENDING_APPROVAL`/`APPROVED`. Dismissing a plan before dispatch guarantees the plan is marked `DISMISSED` locally and that the CALL-E API is never contacted for it.
- **Dismissal after dispatch does not cancel the call:** Once a plan has been sent to CALL-E, `dismiss` only updates our local record — it does **not** stop, hang up, or cancel the provider-side call. Use the executor's explicit cancel path (`CalleClient.calls_cancel`) for that.
- **In-flight Cancellation:** If a call has already been dispatched, the system can send a best-effort cancellation request via `CalleClient.calls_cancel` to the remote API. This is a request to the provider to stop the call, not a guarantee — telephony network propagation means it is not guaranteed to terminate an active call synchronously, or at all.
