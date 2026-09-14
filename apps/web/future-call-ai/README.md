# Future Call AI

Future Call AI is an experimental, evidence-first CALL-E demo app for bounded phone tasks. It separates provider completion from an advisory classification of task success: the verifier looks for extracted supporting evidence for each required goal condition and no surviving contradiction. `VERIFIED_SUCCESS` is an application label, not independent certification that an appointment, payment, or other real-world change occurred.

- Source: https://github.com/luigipitasi91-tech/Earendel-CALLE
- Live demo: https://future-call-ai.onrender.com
- Backend: https://earendel-calle.onrender.com

## What it demonstrates

1. A user describes a phone task in plain language.
2. The app compiles it into a Goal Contract.
3. Guardian checks the configured consent and data boundaries and supplies constraints to the calling workflow.
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

A captured live E2E result is also available in the UI as author-reported evidence, not independently verified here. Use Simulated mode and synthetic data for repeated evaluation; no additional real call is needed.

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
- instructions prohibit inventing missing identity or booking data
- configured boundaries prohibit recipients from expanding the caller's authority
- configured data rules prohibit forbidden disclosure; they are not a universal guarantee
- paid alternatives require new user authority
- provider `completed` never forces a successful goal verdict
- medical, legal, financial, and emergency decisions remain outside the app's autonomous authority

Result extraction and conversational compliance remain experimental. A person must verify consequential outcomes through an authoritative channel before acting on an application verdict.

## Verification

The source repository contains an automated test suite and a captured live E2E result. The author reports that the test produced supporting evidence for the requested appointment change and no-additional-charge condition before the app emitted `VERIFIED_SUCCESS`. The live result and test claims were not independently verified here and are not production certification.

For repeated review, use Simulated mode or inspect the author-reported captured result without spending additional CALL-E credits.
