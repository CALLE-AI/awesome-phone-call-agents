# Service Rescue

Service Rescue is a consent-first web app for checking home-service-provider availability through CALL-E. It gathers a repair request, presents a bounded call plan, requires explicit approval, and returns structured availability information for human review.

## What it supports

- Local no-call demonstrations by default.
- A one-provider availability inquiry for home services such as plumbing or electrical repair.
- Explicit authorization, a non-emergency acknowledgement, and an exact `CALL` confirmation before a live request.
- Structured results for availability, estimate, arrival window, and booking method.
- A local audit trail and idempotency protection against duplicate starts.

## Requirements

- Node.js 20 or later.
- A CALL-E API key only for optional live mode.

## Run the safe demo

```bash
cd apps/web/service-rescue
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000` and sign in with `tester` / `tester123`.

Enter any syntactically valid fictional E.164 number, such as `+14155550123`, then prepare and confirm a call plan. With `CALLE_MODE=demo` (the default), the app returns a clearly labelled local demonstration result and never contacts a phone number or CALL-E.

## Optional live verification

Set `CALLE_MODE=live` and add `CALLE_API_KEY` to the local `.env` file. Restart the server, then use only a provider number you are authorized to contact. The user must review the plan, confirm authority, acknowledge that the request is not an emergency, and type `CALL` before one live request is created.

## Side effects and boundaries

In demo mode, there are no external side effects. Live mode can create one outbound CALL-E request after the explicit confirmations above. The app does not schedule recurring calls, make bookings, accept payment details, or agree to charges. It is not for emergencies; users must contact local emergency services for imminent danger.

There is no recurring workflow to cancel. For an in-progress live call, use the CALL-E provider controls. Avoid committing real phone numbers, API keys, transcripts, or local `data/` files.

## Manual verification

1. Start in the default demo mode and complete the form with a fictional E.164 number.
2. Verify that incomplete fields and malformed numbers are rejected.
3. Verify that both acknowledgement checkboxes and the exact `CALL` text are required.
4. Complete the confirmation and verify that the result says no phone call was placed.
