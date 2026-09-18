# Customer Churn Rescue — Python Reference App

A small Streamlit reference application demonstrating the `customer-churn-rescue` CALL-E Agent Skill.

## Purpose

The app demonstrates a complete, bounded retention workflow:

1. Load a subscription customer's context.
2. Apply an explicit retention policy.
3. Use CALL-E for the adaptive phone conversation when live calling is available.
4. Receive structured results, transcript, summary, and evidence.
5. Independently validate commercial authorization in Python.
6. Persist real results locally.
7. Aggregate retention/churn metrics.
8. Optionally use an OpenRouter or Ollama-compatible LLM for post-call analysis.
9. Visualize outcomes in Streamlit.

## Modes

### Demo / no-call

Uses `fixtures/demo_results.json`. This mode makes no phone calls and does not require a CALL-E key.

### Real calls

Reads records saved to `data/calls.json` after a real CALL-E call. Live calling is intentionally started from the command line so a browser click cannot silently trigger a paid/real phone action.

### Demo + real calls

Combines synthetic fixtures and locally stored real results for a convenient hackathon presentation. Synthetic records are labeled `SYNTHETIC`; real CALL-E records are labeled `REAL`.

## Setup from scratch

The current stable CALL-E Python SDK requires Python 3.11 or newer. This app pins `calle-ai==0.7.0`.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Create `.env` next to `app.py`:

```text
CALLE_API_KEY=your_real_key
```

Never commit `.env` or a real API key.

## Run the safe demo

```powershell
streamlit run app.py
```

Select **Demo / no-call** in the sidebar. This is the recommended first run.

## Run one live CALL-E call

Only use a phone number you are authorized to call and a region that your CALL-E account currently supports.

```powershell
python calle_client.py --phone +14155550100 --name TestCustomer --customer-id DEMO-001 --plan pro --tenure-months 12 --region US --locale en-US
```

The example number is standards-reserved and is shown only as a format example; replace it with your authorized test number.

The CLI prints the returned CALL-E object and stores the terminal result in `data/calls.json`.

## Post-call LLM analysis (optional)

The LLM is **not** used to authorize or create commercial offers. It is an advisory post-call analyst.

### OpenRouter

Create environment variables in `.env`:

```text
OPENROUTER_API_KEY=your_key
LLM_PROVIDER=openrouter
LLM_MODEL=openrouter/free
```

Then start Streamlit and use **Analyze this call** on a completed conversation.

### Ollama

Run a local model with Ollama, then use:

```text
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
```

The default local OpenAI-compatible endpoint is `http://localhost:11434/v1`.

If LLM configuration is absent, the rest of the app continues to work normally.

## Live-call diagnostics

CALL-E is evolving quickly, so verify the actual enabled calling region before spending a call credit. A `NO ANSWER` or `FAILED` result with zero duration and no transcript must be treated as a failed attempt, not as a customer decision.

The app uses a unique idempotency key per explicit attempt. This avoids the development problem where reusing the same key returns the original call task rather than starting a new attempt.

The Python SDK uses the generic one-shot CALL-E call API and imports `CalleClient` from `calle`.

## Files

- `app.py` — Streamlit UI, demo/real/combo modes, analytics, transcript viewer, optional LLM analysis.
- `calle_client.py` — CALL-E task creation, dynamic result schema, unique idempotency key, CLI entry point, local result storage.
- `retention_engine.py` — deterministic offer authorization, result classification, analytics, transcript normalization, optional post-call LLM analysis.
- `call_store.py` — local JSON persistence and deduplication by CALL-E call ID.
- `policy.json` — example company retention policy.
- `fixtures/demo_results.json` — synthetic results for no-call development and demo.
- `data/calls.json` — created locally after live calls; excluded from source control.
- `.env.example` — environment-variable template with no secrets.

## Data and privacy

Only synthetic examples are included in the repository. Real call results should stay local and should not be committed to Git. The dashboard masks phone numbers when displaying them. Production deployments need access control, database security, retention limits, consent/contact governance, and a formal privacy/compliance review.

## Testing

Skill tests do not place phone calls:

```powershell
cd ..\..\..\..\skills\customer-churn-rescue
python scripts\self_test.py
```

Validate the demo result directly:

```powershell
python scripts\validate_result.py assets\sample-call-result.json
```

Validate an offer:

```powershell
python scripts\validate_offer.py `
  --customer assets\sample-customer.json `
  --policy assets\sample-policy.json `
  --reason price `
  --offer save20
```

## Limitations

This is a focused hackathon/reference implementation, not a production retention platform. It intentionally avoids a queue, CRM, production database, identity system, sophisticated churn prediction, and automated commercial transactions.
