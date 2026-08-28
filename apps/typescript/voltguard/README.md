# VoltGuard: Level 2 Voice Escalation

**⚠️ WARNING: EXPERIMENTAL / NON-PRODUCTION ⚠️**  
This application is an experimental sketch. **It does NOT implement physical lockout, hardware unlock, or reset routing.** 

### Honestly Fake-Only Execution & Constraints
* **Simulated Side Effects:** This endpoint is configured as an "honestly fake-only" path. It **does NOT** execute a live Call-E SDK voice call. Passing `confirm_live_run: true` will securely simulate the execution, log the intended intent-bound recipient, and return a `simulated_live_success` response.
* **Failure Behavior:** The system fails closed. If `WEBHOOK_SECRET` is unset, the application immediately aborts on startup. If a request is unauthorized, missing an E.164 recipient, or missing the `personnel_clear` flag, it returns an HTTP 40X error.

---

## Runnable Contract (Install, Test, & Run)

### 1. Install Dependencies
`npm install`

### 2. Run Tests
Ensures the authorization logic and baseline configuration pass checks.
`npm test`

### 3. Start the Server
Runs the webhook securely on port 3000.
`npm start`