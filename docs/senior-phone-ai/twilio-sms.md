# Australian Twilio SMS pilot

This adds a live Twilio adapter to the authorized SMS service, a signed delivery
callback, and a server-only post-call factory. It is an outbound SMS pilot; the
complete telephone-to-search-to-SMS experience still needs the bridge described below.

## Setup

1. Obtain a numeric SMS-capable Twilio sender. For future replies, check that the
   actual number supports receiving SMS too. Do not choose an alphanumeric sender
   for two-way messaging. Review the current
   [Australian guidelines](https://www.twilio.com/en-us/guidelines/au/sms).
2. Enable Australia in Messaging geographic permissions and complete the account
   requirements Twilio displays. Trial accounts may require recipient verification.
3. Store the Account SID and Auth Token in the app's ignored `.env.local` as
   `SMS_ACCOUNT_ID` and `SMS_AUTH_TOKEN`. Never put credentials in chat, prompts,
   source, browser code or logs.
4. Set `SMS_FROM_NUMBER` to the numeric sender in E.164 format and
   `SMS_TEST_RECIPIENTS` to comma-separated, explicitly consented Australian test
   mobiles in `+614xxxxxxxx` format. Replace the local mobile's leading `0` with
   `+61`. An allowlist entry does not replace consent or action authorization.
5. For the local CALL-E demo, leave `SMS_STATUS_CALLBACK_URL` blank; delivery
   status is polled from Twilio without public access. For the generic Supabase
   service or optional callback delivery tracking, expose only
   `/api/twilio/sms/status` over public HTTPS. Set
   `SMS_STATUS_CALLBACK_URL` to that exact URL, without query or fragment. Do not
   expose the local call/briefing administration pages through the tunnel.
6. For the generic Supabase SMS service, apply its schema and server credentials.
   The [CALL-E local workflow](calle-followups.md) uses encrypted local storage and
   does not require Supabase. Set
   `SENIOR_PHONE_AI_MODE=live` and `SMS_ENABLED=true` for an approved test. Each
   message includes the callback URL, so this status endpoint needs no additional
   console webhook setting.

## Post-call integration and remaining work

Trusted workers can call `createPostCallFinalizer()` in the app's
`lib/post-call/server.ts`. After verifying call ownership, finalize a terminal
CALL-E snapshot, review the generated message, obtain one-time authorization for
the exact message/destination/principal/senior/purpose/correlation/idempotency key,
then call `sendOptedInFollowup(record, true, request)`. This is not a public dispatch
endpoint. Never infer authorization from provider summaries or transcript text.

The [CALL-E follow-up workflow](calle-followups.md) captures one customer request
and SMS permission during the call, checks the terminal evidence, then searches
and sends through this adapter. It uses encrypted local storage. Incoming SMS
replies and pre-call texts are not implemented.

## Delivery, cancellation and safety

- Preview mode or `SMS_ENABLED=false` selects the no-network preview adapter.
- Live sending requires the recipient allowlist, rejects redirects, uses a fixed
  Twilio API origin and times out after 15 seconds.
- The service durably reserves an idempotency key before dispatch. The adapter
  never retries and does not assume provider-side message-creation idempotency.
- API acceptance is `queued`. Local CALL-E history also polls authenticated
  message status, without resending. Verified `delivered` callbacks map to the existing
  `sent` state; `failed` and `undelivered` map to `failed`. Intermediate callbacks
  are ignored so late `sent` events cannot overwrite a terminal result.
- Signatures include every form field and the configured public URL. Invalid
  signatures/accounts are rejected; terminal events are deduplicated.
- A callback that races Message SID persistence returns 503. Configure provider
  webhook retries and reconcile outstanding messages if callbacks are exhausted.
  Timeouts, server errors, malformed success responses and crashes before SID
  persistence remain `unknown`; reconcile before another send. Do not retry with
  a fresh idempotency key.
- Callbacks update SMS history. The post-call record reflects dispatch outcome,
  not a separate delivery receipt.
- Set `SMS_ENABLED=false` and restart to disable future sends and callbacks.
  This cannot recall an accepted SMS. This integration creates no recurring jobs
  or automatic calls.

Keep explicit intent, masked-number output, retention and credential protections.
Send only requested minimal information, with no medical/legal/financial advice
or emergency-service promises. Establish working opt-out handling before widening
this controlled test to recurring or general messaging.

## Verification

Run `npm run check` in the app and `python scripts/validate_repository.py` at the
repository root. Twilio tests inject fake HTTP responses and synthetic Australian
fixtures, covering disabled mode, recipient restrictions, uncertain acceptance,
forged callbacks, callback races and an opted-in terminal call dispatched once.
No test places a call or sends a real SMS.

Live verification remains separate: review the exact recipient and summary,
confirm one send, receive it on the phone and observe its signed terminal callback
in SMS history. Keep masked evidence only; do not log raw webhook bodies.

References: [message sending](https://www.twilio.com/docs/messaging/tutorials/how-to-send-sms-messages),
[signature validation](https://www.twilio.com/docs/usage/security),
[delivery callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).
