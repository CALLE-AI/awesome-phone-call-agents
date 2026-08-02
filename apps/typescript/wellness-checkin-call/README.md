# Wellness Check-in Call

This focused TypeScript app uses the CALL-E server SDK to place a short, consent-gated wellness check-in call to an elderly or at-risk person, ask three simple questions about how they're doing, and classify the answer as `ok`, `mild_concern`, or `escalate` for a caregiver.

The default mode is a masked preview. It does not contact CALL-E or place a call. Live mode requires the request file to record opt-in from the recipient or whoever manages their care, a separate `--confirm-recipient-opt-in` flag, and a server-side API key.

**This is not a medical device.** The call script and this app never give medical advice or a diagnosis — it's a check-in and a classifier, nothing more.

This is a distilled, English-only reference version of a fuller bilingual (English/Japanese) app with a family dashboard, call history, and email notifications. See [Mimamori-Call](https://github.com/atsushiyago/anpi) (source) and the [live demo](https://call-e-anpi.vercel.app) for the complete version.

## Why this workflow

Checking in on someone who lives alone by phone, every day, does not scale for a family or a small care team. This app converts one consented wellness call into a compact, structured result:

- whether the person answered at all;
- a one-line summary of how they said they're feeling;
- whether they're eating properly; and
- whether they reported a concern or a need.

It does not diagnose, prescribe, dispatch emergency services, or contact anyone on the recipient's behalf — it only classifies and reports.

## Setup

Node.js 20 or later:

```bash
cd apps/typescript/wellness-checkin-call
npm install
```

## Preview without a call

Preview is the default and does not need credentials:

```bash
npm run preview
```

This prints the masked call plan for [`examples/recipient.example.json`](examples/recipient.example.json), which uses a fictional reserved phone number. Copy that file and replace the number with an E.164 number you own or are authorized to call before running live.

## Run one live call

API keys are server credentials. Keep them in a secret manager or environment variable, never in request files or source control.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"

npm run checkin -- --request your-authorized-request.json --execute --confirm-recipient-opt-in --output result.json
```

Live mode creates exactly one CALL-E call task and waits for its terminal result. A stable `wellness-checkin:<workflow_id>` idempotency key prevents a retry from creating a second call for the same recipient.

## Input contract

The request JSON must contain:

- `workflow_id`: a stable, non-secret identifier for this recipient (not a real name);
- `phone`: one E.164 phone number; and
- `recipient_or_caregiver_opted_in`: literal `true` — this app refuses to run without it.

Do not put names, addresses, health history, or other sensitive information in this file. The recipient's name is intentionally not part of the request; the call script never uses one.

## Side effects and safety

- A live run places a real outbound phone call. Use it only after the intended recipient (or whoever manages their care) has explicitly agreed to receive these calls.
- The call always ends after the third question with a brief, polite close.
- Phone numbers are masked everywhere this app prints or writes output.
- The app creates no recurring schedule and checks in on one recipient per run — repeat scheduling is a host/scheduler concern, not this app's.
- The `ok` / `mild_concern` / `escalate` split is a coarse heuristic over CALL-E's structured result, not a clinical judgment. It only decides how quickly a caregiver should be notified, never what's medically wrong.
- Not for medical, legal, financial, or emergency use. If the situation is an emergency, contact local emergency services directly — this app does not.

## Cancellation and rollback

Preview mode has no side effect and needs no rollback. Before live execution, stop by omitting `--execute` or `--confirm-recipient-opt-in`. After the provider accepts a live call task, this app cannot guarantee cancellation; use the CALL-E dashboard or provider controls if they expose a cancel action. This app creates no future jobs to remove.

## Validation

Default tests use an injected fake CALL-E client (see [`fake/calle-server.ts`](fake/calle-server.ts)) and never place a phone call:

```bash
npm run check
npm test
npm run demo
python3 ../../../scripts/validate_repository.py
```

For opt-in live verification, use a phone you own or are authorized to call, retain only the redacted result, and do not commit the request or result file.
