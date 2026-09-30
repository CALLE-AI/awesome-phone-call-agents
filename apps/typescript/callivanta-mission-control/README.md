# CALLIVANTA Mission Control — Public Reference App

A small, portable CALL-E reference app for a restaurant supplier-information mission.

This contribution demonstrates the public integration pattern only. It is intentionally narrower than the private CALLIVANTA product architecture.

## What it does

The app turns one bounded restaurant operations question into a CALL-E phone task:

1. validate an exact approved E.164 destination and mission item;
2. preview the exact questions and prohibited actions;
3. default to **dry run** with no external call;
4. when explicitly enabled, create one CALL-E call with an idempotency key;
5. poll the same call id to a terminal status;
6. return deeply sanitized structured availability evidence;
7. leave purchase, payment, contract, health/allergy, legal, insurance, identity, and account-access decisions to a human.

## Side effects

**Dry run is the default and places no phone call.**

Live mode can place one outbound phone call through CALL-E. Live mode requires all of the following:

- `CALLE_API_KEY` in the environment;
- `CALLIVANTA_LIVE=YES_I_APPROVE_ONE_TEST_CALL_TO_APPROVED_PHONE`;
- `CALLIVANTA_APPROVED_PHONE` set to the exact E.164 destination that was authorized;
- an explicit `--live` CLI flag;
- the same E.164 phone number supplied at runtime;
- an explicit item name, such as `oxtail`.

If the runtime destination differs from `CALLIVANTA_APPROVED_PHONE`, the app fails closed before creating a call.

The sample code contains no real phone number, API key, customer data, supplier commercial terms, or payment data.

## Setup

Requires Node.js 22+.

No package install is required for the direct HTTP example.

```bash
node index.mjs
```

That prints a dry-run preview and performs no network request.

## Dry run

```bash
node index.mjs
```

Expected behavior:

- uses the standards-reserved fictional NANP example `+12025550100`;
- masks the recipient in output;
- names the demo item (`oxtail`) explicitly;
- prints the bounded CALL-E task;
- prints the structured-result schema;
- exits without making a network request.

## Live verification

Only after you intentionally authorize one exact test destination:

```bash
export CALLE_API_KEY="..."
export CALLIVANTA_LIVE="YES_I_APPROVE_ONE_TEST_CALL_TO_APPROVED_PHONE"
export CALLIVANTA_APPROVED_PHONE="+12025550100"   # reserved fictional example only
node index.mjs --live "$CALLIVANTA_APPROVED_PHONE" oxtail
```

Replace the reserved fictional example with the exact approved real test recipient only in your local runtime environment. Never commit the real number or credential.

## Result schema

The app requests:

```json
{
  "availability": "confirmed | unavailable | unknown",
  "quantity": "string",
  "ready_time": "string"
}
```

The structured result is evidence for an operator. It does not authorize a purchase or other commitment.

Before terminal output, the app recursively sanitizes provider results and evidence. Phone numbers, email addresses, authorization/token fields, transcripts, recordings/audio fields, and API-key-like strings are redacted. Provider error bodies are never echoed to the terminal.

## Duplicate protection

The call creation request sends a stable `Idempotency-Key` derived from the exact recipient and item. If a local timeout occurs after call creation, preserve the returned call id and resume status checks instead of creating a new call.

## Cancellation / rollback

This example creates at most one outbound call and creates no recurring schedule or background job. There is no recurring job to cancel. After a call is placed, the call itself cannot be rolled back; downstream business action is intentionally human-controlled and therefore has not occurred automatically.

## Safety boundaries

The task explicitly forbids the agent from:

- placing an order;
- authorizing payment;
- accepting or negotiating contract terms;
- committing to pickup or delivery;
- making health/allergy, legal, insurance, identity, or account-access decisions.

The app is not for emergency workflows.

## Test

```bash
node --test test.mjs
```

Tests use injected fake HTTP responses and place no real phone calls.

## Provider

CALL-E Developer API: `https://api.heycall-e.com/v1/calls`

Credential: `CALLE_API_KEY` environment variable only.
