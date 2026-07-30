# VibeHub Founder Relay

A focused TypeScript demo that uses CALL-E to turn an opted-in founder match into one short collaboration-readiness call and a structured result.

The call confirms four fields: whether the recipient is available now, interest in a seven-day experiment, preferred collaboration focus, and preferred start window.

## Safety and side effects

- `npm start` is preview-only and never places a call.
- A live call requires both `CALLE_RECIPIENT_CONSENT=YES` and the exact CLI confirmation `--place-call I_HAVE_CONSENT`.
- Use only a number you own or whose owner explicitly authorized the call.
- Phone numbers are masked in console summaries and hashed for idempotency.
- A stable run ID prevents duplicate calls if result polling is interrupted.
- The agent discloses that it is automated, asks whether now is convenient, ends on refusal, stays under one minute, and avoids sensitive topics.
- This app creates no recurring job. To stop a queued or active call, use the CALL-E dashboard and the printed Call ID. Do not start a new run until the earlier call reaches a terminal state.
- This workflow is not for medical, legal, financial, authentication, emergency, or high-risk content.

## Requirements

- Node.js 20 or newer
- A CALL-E account and server-side API key for opt-in live verification
- A supported recipient region

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` locally. Never commit the real file, an API key, or a private phone number.

## Preview (default, no call)

```bash
npm start
```

The preview prints a masked recipient, region, run ID, duration, and the exact CALL-E task. It does not require a live call.

## Live verification (one authorized call)

1. Obtain explicit consent from the number owner outside this app.
2. Set a real E.164 number and `CALLE_RECIPIENT_CONSENT=YES` in `.env`.
3. Use a fresh `FOUNDER_RELAY_RUN_ID` for this newly authorized call.
4. Run exactly once:

```bash
npm start -- --place-call I_HAVE_CONSENT
```

The app prints the Call ID immediately, then polls only for the result. Temporary polling errors never create another call.

## Tests

```bash
npm test
npm run typecheck
```

Tests are local and do not require credentials or place calls.

## Expected structured result

```json
{
  "available_now": "yes",
  "interest": "yes",
  "focus": "engineering",
  "start_window": "this_week"
}
```

This is a community demo app, not a CALL-E SDK or supported product API.
