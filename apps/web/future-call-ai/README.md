# Future Call AI

Future Call AI is an evidence-first CALL-E demo app for bounded real-world phone tasks. It separates provider completion from verified task success: a CALL-E call is not considered successful until each required goal condition has supporting evidence and no surviving contradiction.

- Source: https://github.com/luigipitasi91-tech/Earendel-CALLE
- Live demo: https://future-call-ai.onrender.com
- Backend: https://earendel-calle.onrender.com

## What it demonstrates

1. A user describes a phone task in plain language.
2. The app compiles it into a Goal Contract.
3. Guardian enforces explicit consent, allowed data, forbidden data, and hard constraints.
4. Relative weekday references are resolved before provider execution.
5. CALL-E performs the authorized call.
6. Provider results are mapped into supporting, contradicting, or insufficient evidence.
7. The verifier classifies the outcome as `VERIFIED_SUCCESS`, `PARTIAL`, `UNKNOWN`, or `FAILED`.

The core rule is:

```text
provider completed != task completed != verified success
```

## Safe default / dry run

The public UI defaults to **Simulated** mode. Simulated mode does not place a real phone call and consumes no CALL-E credits. It includes deterministic scenarios for successful, partial, unknown, failed, forbidden-data, and provider-failure outcomes.

A captured production E2E result is also available in the UI so reviewers can inspect the verified live path without spending credits or placing another call.

## Live side effects

Live mode places a real outbound phone call through CALL-E and consumes CALL-E credits. It is opt-in only and requires explicit user confirmation before a new live call can be started.

The app suppresses duplicate live requests with a stable idempotency key and backend duplicate window. The browser persists the active job and resumes polling the same CALL-E job after refresh or timeout instead of silently starting another call.

## Credentials

The CALL-E API key is server-side only. The browser never receives it.

For the source project, configure the backend environment with:

```bash
export CALLE_API_KEY="..."
```

Do not commit provider credentials, personal phone numbers, private transcripts, or API tokens.

## Setup

The complete runnable source and deployment configuration live in the source repository linked above.

Backend tests:

```bash
cd backend
PYTHONPATH=. pytest -q
```

Frontend production build:

```bash
cd frontend
npm install
npm run build
```

The source repository CI runs both the backend test suite and the frontend production build.

## Cancellation and recovery

Future Call AI does not create recurring schedules. Before a live CALL-E job is created, the user can simply leave live mode or withhold confirmation. After a provider job has started, the UI does not create a second job as a substitute for cancellation; it keeps tracking the existing job and reports its terminal provider state. A failed, rejected, or unknown outcome is surfaced as such rather than retried blindly.

## Safety boundaries

- explicit user authorization before execution
- E.164 phone-number validation and route gating
- no invention of missing identity or booking data
- recipients cannot expand the caller's authority
- forbidden data cannot be disclosed
- paid alternatives cannot be accepted without new user authority
- provider `completed` never forces a successful goal verdict
- medical, legal, financial, and emergency decisions remain outside the app's autonomous authority

## Verification

The source repository contains an automated certification suite and a captured production E2E result. The verified live test confirmed both the requested appointment change and the no-additional-charge condition before the app emitted `VERIFIED_SUCCESS`.

For repeated review, use Simulated mode or the captured E2E proof instead of spending additional CALL-E credits.
