# Permit Status Clarifier

Permit Status Clarifier is a focused local web app and CLI that uses the CALL-E Python SDK to turn one authorised call to a municipal permit desk into a structured blocker-and-next-action brief.

The default path is a masked preview. It never contacts CALL-E or places a call. Live mode requires recorded authority, confirmation that the recipient is a published department number, a second explicit live-call confirmation, and a server-side API key.

## Why this workflow

Small contractors and project owners often hear only that a permit is “under review.” The useful details—what is missing, who owns the next step, where corrections belong, and when a response expires—may be available only by phone. Permit Status Clarifier packages that narrow phone task without pretending to give legal advice or letting an agent make commitments.

One completed call can return:

- the recorded review status;
- a plain blocker summary;
- the exact next action;
- a response or expiry deadline;
- the official resubmission channel;
- fee information without authorising payment; and
- a public follow-up team, extension, or reference.

## Setup

Python 3.11 or later and `uv` are recommended:

```bash
cd apps/python/permit-status-clarifier
uv sync --dev
```

## Run the local web app

The server binds to `127.0.0.1` by default and starts in preview-only mode:

```bash
uv run python server.py
```

Open `http://127.0.0.1:8787`. The browser builds a masked call plan and displays the exact task, recipient region, result schema, and stable duplicate-call key before a live-call control can appear.

The UI does not use analytics, persist form data, or send data to third parties in preview mode.

## Preview from the CLI

`example_request.json` uses a fictional reserved number. Copy it and replace the number only with a published department line that you are authorised to call.

```bash
uv run python client.py --request example_request.json
```

Add `--output new-plan.json` to create a private mode-`0600` file. Existing files are never overwritten.

## Run one live CALL-E call

API keys are server credentials. Keep them in an environment variable or secret manager, never in request files, browser storage, or source control.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"

uv run python client.py \
  --request your-authorised-request.json \
  --execute \
  --confirm-authority \
  --confirm-public-number \
  --output call-result.json
```

For the web UI, start `server.py` with the same environment variables. A live call still requires the two context checkboxes, a successful masked preview, and a separate “place one real call” checkbox.

## Input contract

The request JSON must contain:

- `workflow_id`: a stable non-secret id used for duplicate-call prevention;
- `phone`: one E.164 public department number;
- `caller_has_authority`: literal `true`;
- `recipient_is_public_department_number`: literal `true`;
- `organization_display_name`: the caller identity disclosed to the desk;
- `jurisdiction` and `department`;
- `permit_reference`: a non-personal public or applicant-facing reference;
- `project_type`: a short non-sensitive description;
- `region` and `locale` supported by CALL-E; and
- `questions`: two to seven supported factual question ids.

Do not put a person’s name, home address, phone number, email address, credentials, payment data, or other personal information into the permit reference or project description.

## Side effects and safety

- A live run places exactly one real outbound phone call.
- The agent discloses that it is an AI calling assistant and ends if the recipient declines an AI caller.
- The call is limited to a factual permit-status inquiry. It does not request legal interpretation, dispute a decision, schedule an inspection, submit material, make a payment, accept terms, or promise work.
- Fee details are recorded as information only. The app cannot authorise or transmit payment.
- The workflow is not for emergency, medical, legal-advice, financial, collections, political, marketing, enforcement, or private-recipient calls.
- Phone numbers and permit references are masked in previews. Phone numbers and email addresses are redacted from returned summary fields.
- There is no scheduler, batch mode, hidden retry, or recurring call.

## Cancellation and rollback

Preview mode has no external side effect and needs no rollback. Before a live call, omit `--execute`, either CLI confirmation, or the final web confirmation. After CALL-E accepts a call task, this demo cannot guarantee cancellation; use the CALL-E dashboard or provider controls if a cancel action is available. No future job remains to remove.

The stable `permitstatus-<workflow_id>` idempotency key prevents a repeated execution of the same workflow from creating a duplicate task when the provider honours the key.

## Validation

Default tests inject a fake CALL-E client and never place a call:

```bash
uv run pytest -q
python3 ../../../scripts/validate_repository.py
```

For opt-in live verification, call only a published department test line or a phone you own and are authorised to use as a simulated permit desk. Keep the request and result private; commit only the masked demo evidence.
