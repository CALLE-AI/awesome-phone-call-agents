# SurplusSignal

SurplusSignal is a consent-first coordinator for time-sensitive surplus-food pickup confirmations. It calls only donors whose opt-in for the specific drive is recorded, validates a fixed structured result locally, and produces an unverified candidate manifest for a human dispatcher.

The default workflow is a local preview or fake demo. It cannot place a call without locally configured CALL-E credentials, a fresh authorization window, two explicit execution flags, a request-bound receipt, and a new private output path.

## Why this workflow

Food-rescue coordinators can lose a pickup window while manually reconfirming whether a pledge still exists, how many units remain, and when a driver could arrive. A generic call summary is not safe to dispatch from: silence can look like agreement, changed quantities can be missed, and free-form notes can leak unnecessary personal data.

SurplusSignal:

1. accepts one to six drive-specific, recently opted-in donor contacts;
2. previews the exact disclosure and task for every masked number;
3. creates at most one independently idempotent CALL-E task per donor;
4. accepts only strict fields for consent, availability, quantity, proposed slot, storage mode, and packaging state;
5. stops before another donor after a provider failure or malformed result; and
6. outputs only a redacted candidate manifest that still requires human identity, address, handling, capacity, and food-safety review.

It never accepts a donation, promises or schedules a pickup, selects a driver, makes a food-safety decision, or collects a person's name, address, email, payment data, health information, ingredients, allergens, expiration dates, transcripts, recordings, or provider summaries.

## Try it without an account

Use Node.js 20 or later:

```bash
cd apps/typescript/surplus-signal
npm install
npm run check
npm test
npm run demo
```

`npm run demo` uses an in-process fake CALL-E port. It makes no network connection and no phone call. The fictional sequence confirms one pledge, reduces another, withdraws a third, and prints a two-row human-review manifest.

The included `+1 202-555-01xx` numbers are reserved fictional examples and the timestamps are intentionally historical. Never execute the sample as a live request.

### Local simulation dashboard

Run the responsive dashboard against the same checked-in fictional fixture:

```bash
npm run ui:dev
```

Open the printed local URL, select a donor, and choose `Run local simulation`. The staged disclosure, agreement, structured result, and manifest are entirely local UI state: the dashboard has no CALL-E client, network request, or live-call control. `Reset` cancels the staged sequence and clears every simulated result.

Create the production UI bundle with:

```bash
npm run ui:build
```

## Preview a drive

Create the ignored private directory, copy the sample, and replace every fictional value:

```bash
mkdir -p private
cp examples/drive.example.json private/drive.json
npm run surplus-signal -- preview --request private/drive.json
```

Before setting `automated_call_opt_in_confirmed`, a human operator must have a record that the donor authorized an automated confirmation call for this specific drive. Opt-in may be at most seven days old, must cover the call window, and does not replace the recipient's right to refuse after the disclosure at the start of the call.

The preview masks each number, shows the authorization window, prints the exact task that will be sent, and produces a content-bound receipt. Changing any donor, pledge, slot, policy, or time changes that receipt.

## Run one controlled live drive

Live mode can create real outbound calls. Use only numbers owned by test participants or contacts that expressly opted in to this exact automated drive confirmation. Confirm applicable calling, recording, privacy, and food-donation requirements before non-test use.

After configuring the documented CALL-E credential in the local environment, run:

```bash
npm run surplus-signal -- run \
  --request private/drive.json \
  --live \
  --confirm-authorized \
  --receipt RECEIPT_FROM_PREVIEW \
  --output private/drive.report.json
```

The client accepts only CALL-E's documented production API origin. Tests inject an in-memory request handler instead. The report path is exclusively created with mode `0600` before the SDK is loaded. Before each provider create, it stores the deterministic idempotency key; after acceptance, it stores the CALL-E call ID. If execution fails, reconcile the checkpoint in the official dashboard before considering any new call. Do not change a key merely to retry.

## Input boundary

A request requires:

- an opaque drive ID in the form `drive-` plus 12 lowercase hexadecimal characters;
- operator authorization recorded within 24 hours of the end of a two-hour-or-shorter call window;
- one to six unique E.164 contacts, each with a unique non-sensitive pledge reference and explicit drive-specific automated-call opt-in recorded within seven days;
- a short English donor label, food category, unit name, expected unit cap, expected storage mode, country code, and locale;
- one to four explicit UTC pickup-window choices; and
- voicemail, AI disclosure, and human dispatch review locked on.

Unknown fields, duplicate identifiers or numbers, control and bidirectional characters, prompt-like values, stale consent, expired authorization, and execution with less than ten minutes left are refused.

Input strings are deliberately narrow. Do not put a person's name, address, callback instructions, ingredients, allergens, medical information, payment information, credentials, or free-form scraped or model-generated prose in a request.

## Evidence and dispatch boundary

CALL-E is asked for exactly eight per-recipient fields with `additionalProperties: false`: post-disclosure agreement, recipient status, pledge status, capped integer quantity, one offered slot or `none`, storage mode, packaging state, and whether human follow-up is required.

Local validation rejects unknown keys and contradictions such as a withdrawn pledge with nonzero units, a confirmed pledge below its expected units, a reduced pledge at or above the expected amount, a non-reached recipient with pledge evidence, or a result tied to the wrong phone or call ID.

Even a complete row is labeled `ready-for-human-review`, never approved or scheduled. The report contains masked numbers and safe enums only. Free-form summaries, transcripts, recordings, addresses, and food-safety claims are never copied into it.

## Side effects, cancellation, and recovery

- Preview, tests, and demo create no network connection, CALL-E task, schedule, or phone call.
- Live mode creates sequential one-recipient tasks up to `max_calls`; carrier retry behavior is outside this app's cap.
- Every task discloses AI use, CALL-E processing and transcription, and possible recording, then requires explicit agreement before asking pledge questions.
- The workflow does not leave voicemail, persuade a refusal, create recurrence, or automatically retry.
- The app exposes no cancellation command. Use official dashboard or support controls if available after a task is accepted.
- After interruption, reconcile the private checkpoint's call ID and idempotency key. Do not restart automatically.
- A human dispatcher remains responsible for donor identity, pickup address, applicable consent rules, handling and food-safety checks, route capacity, and every real-world commitment.

## Validation

```bash
npm run check
npm test
npm run demo
python3 ../../../scripts/validate_repository.py
```

SurplusSignal is a bounded reference app, not a food-rescue service, dispatch system, or substitute for professional food-safety and legal review.
