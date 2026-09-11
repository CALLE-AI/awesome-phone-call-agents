# PartLine

PartLine helps a maintenance or procurement team find an exact industrial replacement part when downtime is expensive. It turns one approved sourcing request into a bounded CALL-E task, calls only authorized supplier contacts and returns a comparable, evidence-backed shortlist. A human remains responsible for every purchase decision.

## Why phone calls

Industrial stock is often stale online. Shipping cutoffs, exact manufacturer part numbers, on-hand quantity and acceptable alternates are commonly confirmed by phone. PartLine packages that phone work into a safe workflow with a strict result schema.

## Safety model

- Preview is the default and never places a call.
- Every supplier must have a purpose-bound authorization reference.
- Phone numbers are masked in previews.
- A live run requires both `--live` and the exact approval token shown by preview.
- Calls are blocked outside the request's local calling window.
- A stable idempotency key prevents an accidental duplicate batch.
- The agent may gather facts. It may not order, reserve, negotiate or accept terms.
- Unknown, contradictory or low-evidence outcomes remain unresolved for human follow-up.
- PartLine does not automatically store transcripts or phone numbers.
- PartLine is not for emergencies or for medical, legal or financial decisions.
- Supplier answers are sourcing evidence only. They are not purchase authority or engineering approval.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

partline preview fixtures/example-request.json
partline summarize fixtures/completed-call.json --request fixtures/example-request.json
partline web
```

`partline web` opens the local evidence console at `http://127.0.0.1:8787`. It renders a masked call plan and completed supplier evidence from the included fixtures. The browser receives no API key or full phone number and it has no route that can place a call.

The preview prints an approval token and the exact live command. To place real calls, set `CALLE_API_KEY`, run during the configured call window and explicitly approve the preview:

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
partline run fixtures/example-request.json --live --confirm PARTLINE-XXXXXXXXXXXX
```

New CALL-E users receive free calls. Use fictional or owned test numbers until the full workflow has been reviewed.

## Live side effects

A successful live run creates one CALL-E task with one to five approved supplier recipients. CALL-E may then place a phone call to every recipient in that task. PartLine never creates a recurring schedule, orders inventory, reserves stock or accepts supplier terms.

The live action is accepted only when all three conditions hold:

1. `--live` is present.
2. `--confirm` exactly matches the token from the current preview.
3. The request is inside its local weekday calling window.

## Credentials

PartLine reads `CALLE_API_KEY` from the process environment only. It does not load a `.env` file, write the key to disk or print the key. Live credentials are accepted only for the official `https://api.heycall-e.com` origin; any other `CALLE_BASE_URL` fails closed. `.env.example` contains placeholders only. Do not commit a real CALL-E key.

## Cancellation and recovery

Omit `--live` to stay in preview mode. Once CALL-E accepts a task, this client cannot guarantee cancellation. Use any cancellation controls available in your CALL-E account and keep the returned call ID for reconciliation.

If the network response is uncertain, do not immediately rerun the request. Reuse the same unchanged request so its stable idempotency key prevents a duplicate batch, then inspect the existing CALL-E task by call ID. PartLine makes no local or third-party mutations that require rollback.

## Input

See `fixtures/example-request.json`. A request contains the exact part, quantity, non-negotiable specifications, a deadline, a local call window and an allowlist of supplier contacts.

## Output

CALL-E returns one structured result per supplier:

- match status: exact, compatible, none or unknown
- confirmed part number and manufacturer
- available quantity
- unit price and currency when voluntarily provided
- earliest ship date and same-day cutoff
- lead time and any proposed alternate
- a short evidence quote
- whether human follow-up is required

PartLine ranks exact matches first, then compatible matches. Ambiguous results never become recommendations.

## Commands

```text
partline preview REQUEST.json
partline run REQUEST.json --live --confirm TOKEN
partline summarize CALL-E-RESULT.json --request REQUEST.json
partline web --request REQUEST.json --result CALL-E-RESULT.json
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```

## CALL-E integration

PartLine uses the CALL-E Developer API:

- `POST /v1/calls` creates one multi-recipient sourcing task
- `GET /v1/calls/{call_id}` polls for completion
- `result_schema` and `recipient_result_schema` constrain machine-actionable output
- `Idempotency-Key` is derived from the approved request, not a retry attempt

See `docs/WALKTHROUGH.md` for a concise product recording guide.
