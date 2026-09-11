# feat(apps): add Rescue Relay

## Summary
Adds Rescue Relay, a Python/FastAPI application for coordinating trusted animal-rescue contacts. It clarifies the reporter’s goal, collects capability and price offers, lets the reporter choose and approve a complete plan, then tracks explicitly confirmed progress to safe closure.

Contribution area: `apps/python/rescue-relay/`.

## CALL-E role
The live REST transport creates one call to an approved saved contact, stores the call ID/idempotency key, polls the provider and reads actual recipient transcript turns. Availability inquiries and selected-helper confirmation callbacks are separate. Every unconfirmed create outcome halts after one POST for reconciliation; a known Call ID is checked with GET only.

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

Remote model calls require an exact HTTPS origin listed in `LLM_ALLOWED_ORIGINS` and a base path ending in `/v1`; the official OpenAI origin is pre-approved. Redirects are disabled. Insecure or nonmatching origins are rejected before a client is created. Credential-free loopback `/v1` development is allowed, but loopback requests never receive the environment `LLM_API_KEY`. Model calls remain backend-only.

Opening, reviewing or selecting a plan does not authorise a confirmation callback. Stop prevents subsequent work, but does not promise to terminate a provider call already in progress. There is no automatic redial.

## Verification
`python scripts/validate_repository.py` passes against the corrected contribution branch. The offline suites report **673 Python tests passed** and **77 JavaScript tests passed**. The history was rewritten from current upstream `main`; all full-number fixtures now use the reserved `202-555-01xx` range. Current branches/tags and child forks contain no reference to the removed object. GitHub Support ticket **#4748240** requests PR-reference/cache dereferencing and server-side garbage collection for the host-retained prior object. See `docs/VERIFICATION_5_6.md` for results and limits.

The live transport follows CALL-E's documented Calls API contract: bearer authentication, stable idempotency, top-level Call ID persistence, GET-only polling, terminal status handling and nested recipient transcript turns. Redacted, bounded `error.message` and `error.details.questions` guidance is retained without exposing the private provider body.

## Product demonstration
Public video: https://www.youtube.com/watch?v=GcaoplYcIh0

Public mock-only product test: https://rescue-relay.onrender.com

The hosted service uses fail-closed HTTP Basic authentication on every route except the minimal `/health` readiness endpoint. Credentials are stored only in Render and Devpost’s private testing instructions; none appear in Git, the API configuration response, or frontend assets.

The 2:55 v5.6 product demonstration uses the running application, fictional test contacts and prices in USD. The complete app folder includes the chapter player, guide and both rendered MP4s; `scripts/record_tutorial.py` reproduces the current short cut. The longer tutorial is retained as historical supplementary material. Media may be moved to public release assets if maintainers prefer, provided the player links are updated together.

The Render service uses the $0 Free plan, fictional data, `CALL_MODE=mock`, `ENABLE_LIVE_CALLS=false`, and no CALL-E or LLM credentials.
