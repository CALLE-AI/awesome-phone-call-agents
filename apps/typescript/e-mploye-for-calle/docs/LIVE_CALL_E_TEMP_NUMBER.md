# Controlled live proof with a temporary test number

This runbook is for one private integration proof. It is not required for the public demo, which must remain fake-only.

## Why a temporary number is needed

Argentina (`AR`) is not currently listed in CALL-E's supported regions. Use only a destination region listed in the current [CALL-E integration guide](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages), and only a number that the operator controls or has explicit permission to call.

## Preferred free route: Twilio Trial

Twilio's trial currently advertises 30 days, free voice units, and a trial phone number without requiring a credit card. Trial restrictions still apply: account verification is required, recipients may need verification, geography is limited by the signup country, and the available number inventory may vary. Read the [official Twilio trial limits](https://www.twilio.com/docs/usage/trials) immediately before testing.

1. Activate **30 days free trial**, never **Pay as you go**.
2. Select a trial voice number in a CALL-E-supported destination country, if Twilio offers one for the account.
3. Configure the trial number to answer inbound voice calls with a harmless scripted appointment response using Twilio's test Voice flow.
4. Verify the number from the Twilio console using the account's own verified phone. Do not use a public shared phone service.
5. Configure the private E-mploye server with the temporary number as `CALLE_TEST_PHONE`, the matching `CALLE_TEST_REGION`, and the matching `CALLE_TEST_LOCALE`.
6. Confirm `CALLE_LIVE_ENABLED=true`, the official CALL-E base URL, and a separate `EMPLOYE_API_TOKEN`.
7. Run exactly one call through E-mploye: load workspace → preview → request approval → authorize → wait for the result → review.
8. Export only redacted evidence. Keep the raw Twilio and CALL-E records private and delete them after the judging proof is captured.

For a deterministic private proof, the demo also ships two static TwiML responses under `public/twiml/`. Deploy the app privately, configure Twilio's inbound custom webhook to the reschedule URL for the first test, and switch it to the confirm URL for the second test. These flows speak first, collect one speech response, and end without exposing a phone number or storing the audio in the repository.

Twilio may refuse to provision a suitable number or restrict voice traffic for an Argentine trial account. If that happens, stop; do not upgrade or add payment details just to force the test. Ask the CALL-E team for a temporary authorized test destination or use a willing tester in a supported country.

## What not to use

Do not use anonymous temporary-number websites, public SMS/voice inboxes, scraped phone lists, numbers shown in screenshots, or a number belonging to someone who has not explicitly agreed. They can expose audio and transcripts, do not provide reliable two-way behavior, and create a privacy/compliance risk.

## Private configuration template

Keep this in a local ignored `.env` or a private secret store. Replace every placeholder locally; never commit the real values.

```text
CALLE_LIVE_ENABLED=true
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_API_KEY=<server-only-call-e-key>
CALLE_TEST_PHONE=<authorized-e164-test-number>
CALLE_TEST_REGION=<supported-region>
CALLE_TEST_LOCALE=<matching-locale>
EMPLOYE_API_TOKEN=<separate-private-app-token>
```

## Evidence checklist

Record only:

- `provider=live` and terminal status;
- the workflow type and sanitized outcome;
- structured result and confidence;
- transcript with names, phone numbers, URLs, tokens, and contact details removed;
- audit events showing approval before provider execution;
- `realCallPlaced=true` only in a private operator log, never as a claim without the corresponding provider result.

The public submission should say that the demo is fake-only and that a controlled live adapter exists. Never publish the temporary number, raw recording, raw transcript, API key, bearer token, or an unredacted provider response.
