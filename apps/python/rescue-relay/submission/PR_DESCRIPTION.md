# feat(apps): add Rescue Relay

## Summary
Adds Rescue Relay, a Python/FastAPI application for coordinating trusted animal-rescue contacts. It clarifies the reporter’s goal, collects capability and price offers, lets the reporter choose and approve a complete plan, then tracks explicitly confirmed progress to safe closure.

Contribution area: `apps/python/rescue-relay/`.

## CALL-E role
The live REST transport creates one call to an approved saved contact, stores the call ID/idempotency key, polls the provider and reads actual recipient transcript turns. Availability inquiries and selected-helper confirmation callbacks are separate. Uncertain provider status pauses rather than automatically redialling.

## Run the product test path without credentials

```bash
cd apps/python/rescue-relay
python -m venv .venv
# Activate for your shell.
python -m pip install -r requirements.txt
python run.py
```

Open http://127.0.0.1:8000 and choose **Try the demo**. Use the example budget of USD 200, compare the USD 300 and USD 150 complete plans, approve the selected helper, record progress, then confirm safe closure. This credential-free product test path uses fictional contacts. Full steps: `TUTORIAL.md`.

## Credentials and side effects
No keys are required for the fictional product test path. Live mode requires a CALL-E API key, an explicitly enabled live configuration and consenting saved contacts. It is local-only. Public demonstrations must remain isolated fictional sandboxes with no secrets or personal data. One server worker is required.

Opening, reviewing or selecting a plan does not authorise a confirmation callback. Stop prevents subsequent work, but does not promise to terminate a provider call already in progress. There is no automatic redial.

## Verification
See `docs/VERIFICATION_5_6.md` for current results and limits. The v5.6 product demonstration uses the real UI and an isolated fictional API so no private contact data appears in the recording. The live transport follows CALL-E's documented Calls API contract: bearer authentication, stable idempotency, top-level Call ID persistence, GET-only polling, terminal status handling and nested recipient transcript turns.

## Product demonstration
Public video: https://www.youtube.com/watch?v=GcaoplYcIh0

The 2:55 v5.6 product demonstration uses the running application, fictional test contacts and prices in USD. The complete app folder includes the chapter player, guide and both rendered MP4s; `scripts/record_tutorial.py` reproduces the current short cut. The longer tutorial is retained as historical supplementary material. Media may be moved to public release assets if maintainers prefer, provided the player links are updated together.

## Review before posting
Run the repository’s own `python3 scripts/validate_repository.py` in the fork. Review licensing, the diff and secrets. Include only your authorised original code and public-safe assets. Update live verification status only after a genuine consented test.
