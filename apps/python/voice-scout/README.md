# Voice Scout — AI Phone Qualification for Small Businesses

Voice Scout is a reusable CALL-E workflow for qualifying business leads by phone. It calls a lead through a published CALL-E Goal, asks adaptive discovery questions, extracts structured results, and returns an auditable JSON record for a CRM or human follow-up queue.

Cybersecurity is one example use case. The workflow is intentionally industry-agnostic: the same application can qualify leads for websites, managed IT, insurance, staffing, consulting, home services, or other business services by changing the CALL-E Goal and input context.

## What it does

1. Loads a lead from a CSV file or JSON input.
2. Runs in preview mode by default—no phone call is placed.
3. With explicit `--live`, submits one CALL-E Goal Run using an idempotency key.
4. Polls the run until CALL-E returns a result or error.
5. Writes a structured result to JSON for CRM import or human review.

The application does not auto-contact a batch of people, hide that it is automated, or make promises about pricing, eligibility, coverage, or outcomes.

## Architecture

```text
Lead CSV/CRM export
        |
        v
Voice Scout preview + approval boundary
        |
        v
CALL-E published Goal Run
        |
        v
Background-safe polling and structured result
        |
        v
JSON/CRM handoff for human follow-up
```

## Quick start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# Safe demo; never places a call
python app.py --demo

# Preview a lead; still does not call
python app.py --lead examples/synthetic_lead.json

# Live call only after explicit review and approval
export CALLE_API_KEY
export CALLE_GOAL_ID
python app.py --live --lead examples/synthetic_lead.json --output result.json
```

The API key is read from the environment and is never stored in the lead file or result output.

## Lead format

```json
{
  "id": "demo-business-001",
  "business_name": "Northside Bicycle Repair",
  "industry": "Bicycle repair",
  "phone": "+15550000000",
  "lead_source": "local_directory",
  "known_company_size": "small",
  "known_workflow": "Phone calls and web inquiries are handled by the owner",
  "known_pain_points": "Missed calls during repair appointments"
}
```

Use a synthetic or authorized test number while evaluating the workflow. Phone numbers must be E.164 formatted.

## CALL-E Goal contract

The published Goal should be configured to:

- Identify itself as an automated assistant.
- State why it is calling and ask permission to continue.
- Handle gatekeepers, voicemail, wrong numbers, and not-interested responses.
- Ask practical business-discovery questions without pretending to be a human.
- Return structured fields for interest, decision-maker status, company size, current workflow, pain points, and follow-up.
- Avoid regulated advice, guarantees, or unauthorized commitments.
- Keep transitions tight and avoid long dead air.

The app accepts any published Goal ID through `CALLE_GOAL_ID`; it does not hard-code a cybersecurity-specific Goal.

## Safety and operational notes

- Preview mode is the default.
- `--live` requires both `CALLE_API_KEY` and `CALLE_GOAL_ID`.
- Each run uses a stable idempotency key derived from the lead ID.
- Console and result output masks phone numbers except for the final four digits.
- The app never retries a submitted run automatically; before submission, cancel with `Ctrl-C`.
- After submission, use the CALL-E dashboard's documented controls to cancel or inspect the run; this app does not create recurring calls.
- Call one authorized test lead before using any real lead list.
- Do not commit `.env`, API keys, real phone numbers, real transcripts, or personal data.
- Human review remains the final step before sales follow-up.
- Results may contain sensitive business information; store them according to the operator's privacy policy.

## Requirements

- Python 3.10+
- A published CALL-E Goal for live operation
- `calle-ai` Python SDK

## Project fit

This is a reusable user-facing app for the CALL-E community repository. The business domain is configurable; cybersecurity is only one example profile, not a product limitation.
