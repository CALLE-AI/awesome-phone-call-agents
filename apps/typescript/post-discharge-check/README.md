# Post-Discharge Check (PDC)

Post-Discharge Check is a consent-gated care-coordination web app for hospital care teams. After a patient is discharged, a scheduled CALL-E agent calls them at the 24-hour, 72-hour, and day-7 marks, holds a natural check-in conversation (pain, medication adherence, wound symptoms, follow-up appointment), surfaces red-flag symptoms with confidence scores while the call is still running, escalates flagged patients to an on-call nurse with transcript context, and returns a structured result per call.

This folder is a catalog entry: the runnable project lives at <https://github.com/cloudnewbie/PDC> and a hosted no-call demo is at <https://cloudnewbie.github.io/PDC/>. All patient data is simulated. It is not a medical device and makes no clinical recommendations — clinical decisions stay with the nurse.

## What it proves

- The called person is always told who is calling (the agent introduces itself as the care-coordination assistant on behalf of the hospital) and identity is verified by date of birth before any health question.
- Red flags (missed anticoagulant dose, wound redness/warmth, fever, chest pain, shortness of breath) surface mid-call with confidence scores and the transcript quote that triggered them, not after the fact.
- Escalation keeps the decision with a human: the agent may page the on-call nurse, but triage, callback, and any clinical action are nurse-owned, and every escalation carries the triggering transcript excerpt.
- Every call ends in a typed structured result (`pain_score`, `meds_taken`, `wound_status`, `red_flags`, `follow_up_appointment`, `callback_requested`, `notes`) defined by a JSON Schema sent with the call, plus `completion_confidence` and platform evidence — so downstream systems read records, not paragraphs.
- The no-call demo mode and live mode share one adapter interface, and the active mode is always disclosed in the UI.

## Run the no-call demo

```bash
git clone https://github.com/cloudnewbie/PDC.git
cd PDC/app
npm install
npm run dev
```

Open `http://localhost:3000`. Without a CALL-E key the app runs in **Demo Simulation** mode: a scripted 14-turn post-op check-in replays through the same adapter interface with realistic timing (transcript turns, red-flag events, agent adaptations, live field extraction). No phone number is required, no CALL-E account is needed, and no call is placed. The active mode is always visible in the top bar and on the Settings page.

## Inspect the CALL-E request without calling

`src/lib/calle.ts` is a typed adapter around the CALL-E Developer API with five methods: `planCall`, `startCall`, `streamCall`, `getStructuredResult`, `endCall`. In live mode `startCall` builds and POSTs the exact request body shown in the repo README: agent `task`, one recipient, `result_schema` / `recipient_result_schema`, `metadata`, and an `Idempotency-Key` header derived per enrollment attempt. `recipient_result_schema` is the structured contract the agent fills during the conversation.

## Live CALL-E use

Live mode activates only when a key is present (`VITE_CALLE_API_KEY` at build time, or a key pasted into Settings at runtime, stored in browser localStorage). Live mode then places **real PSTN calls**:

- `POST https://api.heycall-e.com/v1/calls` places one call to one E.164 recipient with an `Idempotency-Key`;
- the adapter polls `GET /v1/calls/{id}` (5s interval) and `GET /v1/calls/{id}/events`, diffing transcript turns, structured fields, and red flags so the console updates incrementally;
- terminal results are mapped to the app's `StructuredResult`, folding in `completion_confidence` and the platform's `evidence` array.

Live mode places real calls and consumes CALL-E credits. It is intended for the hospital's own enrolled patients; the demo mode exists so reviewers never have to place one.

## Side effects, cancellation, and boundaries

- **Calls are one-off, not recurring.** Cadences (24h / 72h / day 7) are application-level scheduling owned by the care team's campaign enrollment; the repo hosts no cron jobs and CALL-E is not asked to create standing schedules.
- **Stopping a call** means the client stops polling and fetches final state; the adapter also attempts a best-effort `PATCH /v1/calls/{id}` status cancel in case the route lands. A failed or unanswered call surfaces as an explicit retry/no-answer state rather than a silent success.
- **Idempotency**: each live call carries an `Idempotency-Key` so a retry cannot double-dial the same attempt.
- **Credentials**: the CALL-E API key stays in the operator's browser (localStorage) or build environment; it is never baked into the public demo deployment, which is why the public site is demo-mode only.
- **Clinical boundary**: red-flag rules (fever ≥ 38 °C, chest pain, wound drainage, missed anticoagulants) produce escalations to a human nurse with SLA countdowns; the agent never gives medical advice, and "no action needed" is an explicit recorded outcome, not an inference.
