# Callback Window Coordinator

This focused Python app uses the CALL-E server SDK to call a person who already requested a callback, disclose that the caller is AI, offer a small set of human-callback windows, and return a schema-validated choice.

The default mode is a masked preview. It does not contact CALL-E or place a call. Live mode requires the request file to record prior callback consent, a separate `--confirm-recipient-opt-in` flag, and a server-side API key.

## Why this workflow

Service teams often receive callback requests without a usable time window. Repeated missed calls waste staff time and frustrate customers. This app converts one explicitly requested coordination call into a compact result containing:

- right-person confirmation;
- consent to continue after AI disclosure;
- one confirmed offered window;
- voicemail permission; and
- a short evidence summary.

It does not book, cancel, purchase, promise, or modify a service.

## Setup

Python 3.11 or later and `uv` are recommended:

```bash
cd apps/python/callback-window-coordinator
uv sync --dev
```

Copy `example_request.json` and replace its fictional reserved phone number with an E.164 number that you own or are authorized to call. Set a future date and keep the IANA timezone explicit.

## Preview without a call

Preview is the default and does not need credentials:

```bash
uv run python client.py --request example_request.json
```

The printed plan masks the phone number. Add `--output new-plan.json` to create a private, mode-`0600` file. Existing files are never overwritten.

## Run one live call

API keys are server credentials. Keep them in a secret manager or environment variable, never in request files or source control.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"

uv run python client.py \
  --request your-authorized-request.json \
  --execute \
  --confirm-recipient-opt-in \
  --output call-result.json
```

Live mode creates exactly one CALL-E call task and waits for its terminal result. A stable `callwindow-<workflow_id>` idempotency key prevents a retry from creating a second call for the same workflow.

## Input contract

The request JSON must contain:

- `workflow_id`: a stable non-secret workflow identifier;
- `phone`: one E.164 phone number;
- `recipient_has_requested_callback`: literal `true`;
- `business_display_name`: the name disclosed during the call;
- `callback_purpose`: a short, non-sensitive explanation;
- `callback_date`: `YYYY-MM-DD`, today or later;
- `timezone`: an IANA timezone such as `America/New_York`;
- `locale`: a locale such as `en-US`; and
- `available_windows`: two to six `{ "id", "label" }` options.

Do not put names, account numbers, health details, legal matters, payment data, credentials, or other sensitive information in this file.

## Side effects and safety

- A live run places a real outbound phone call. Use it only after the intended recipient explicitly requests the callback.
- The agent announces that it is AI before collecting a choice and ends immediately after a wrong-person response or opt-out.
- The app creates no recurring schedule and processes one recipient per run.
- Phone numbers are masked in previews and removed from returned evidence text.
- The output deliberately excludes transcripts and provider evidence that may contain personal data.
- This workflow is not for medical, legal, financial, emergency, collections, political, or unsolicited marketing calls.

## Cancellation and rollback

Preview mode has no side effect and needs no rollback. Before live execution, stop by omitting `--execute` or `--confirm-recipient-opt-in`. After the provider accepts a live call task, this app cannot guarantee cancellation; use the CALL-E dashboard or provider controls if they expose a cancel action. The call script always lets the recipient decline or hang up, and the app creates no future jobs to remove.

## Validation

Default tests use an injected fake CALL-E client and never place a phone call:

```bash
uv run pytest -q
python3 ../../../scripts/validate_repository.py
```

For opt-in live verification, use a phone you own or are authorized to call, retain only the redacted result, and do not commit the request or result file.
