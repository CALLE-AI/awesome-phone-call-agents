# ForgeGate

**Fail-closed human-verification voice gate for autonomous incident response.**

[Demo Video (YouTube)](https://youtu.be/tmzOpDCel_E) · [Standalone Repository](https://github.com/sufiyan-cyber/Forge_gate)

A CALL-E-powered human-verification gate for autonomous physical/OT security
actions. When an incident-response agent wants to take an irreversible
real-world action (cut power, lock a door, revoke a badge), ForgeGate scores
the incident, and if it crosses a risk threshold, has CALL-E phone a human,
explain the situation in plain language, and gate the action on a spoken
decision. Anything short of a clean **approve** holds the action — no Slack
ping nobody reads, and no ambiguity defaults to "go ahead."

## How it works

```
POST /incident
      |
      v
[risk engine] -- score < threshold --> log AUTO-CLEARED, done
      | score >= threshold
      v
[task composer] -> natural-language CALL-E task string
      v
[CALL-E dispatch] -> places call (idempotent per incident_id), waits for result
      v
[disposition mapping] -> APPROVE | HOLD | ESCALATE | NO_ANSWER | UNCLEAR
      | fail-closed: only a clean APPROVE executes
      v
[action gate] -> EXECUTED or HELD
      v
[audit log] -> apps/python/forgegate/data/audit_log.jsonl
```

## Setup

```bash
cd apps/python/forgegate
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # fill in values before a live call - see below
```

## Usage

Start the server (dry-run by default - no real call is placed, no
`CALLE_API_KEY` required):

```bash
uvicorn app:app --reload
```

Open **http://localhost:8000** for the dashboard — a switchboard-style
console ("The Manual Exchange"): two patch keys fire the demo scenarios,
a jack bank shows each incident as a line that lights up and gets patched
through to the operator only when a call is actually placed, a patch
ticket panel shows the full incident detail (risk score, composed CALL-E
task text, disposition, transcript), and an exchange log ledger holds the
running audit trail. It's a thin client over the same JSON API below —
`GET /scenarios`, `GET /incidents`, `POST /incident` — polling every 2.5s,
no separate build step (`static/index.html`, `styles.css`, `app.js`,
served directly by FastAPI).

Trigger the two demo scenarios from the terminal instead, if you prefer:

```bash
python scripts/trigger_scenario.py high_risk   # crosses threshold -> call placed
python scripts/trigger_scenario.py low_risk    # under threshold -> AUTO-CLEARED, no call
```

or POST directly:

```bash
curl -X POST http://localhost:8000/incident -H "Content-Type: application/json" \
  -d @scenarios/high_risk.json
```

Inspect the audit trail:

```bash
curl http://localhost:8000/incidents/inc_001
curl http://localhost:8000/incidents
```

## Dry-run vs. live calls

`CALLE_DRY_RUN` defaults to `true`. In dry-run mode, `place_call` never
hits the network and returns an immediate mocked result (`HOLD` by default,
override via the `mock_disposition` argument) — this is what lets the whole
incident -> call -> disposition -> action loop be exercised and tested with
**no CALL-E credentials and no phone call**. Every automated test in
`tests/` runs this way.

The live path is verified against the public
[`CALLE-AI/call-e-integrations`](https://github.com/CALLE-AI/call-e-integrations)
README and the [CALL-E resources page](https://call-e.devpost.com/resources)
(fetched 2026-09-13), not guessed:

- **SDK (preferred):** `pip install calle-ai` gives `from calle import
  CalleClient`; `client.calls.create_and_wait(task=..., result_schema=...)`
  both places the call and waits for the result in one call.
  `calle_client.py` uses this automatically when the package is installed.
- **REST fallback:** if `calle-ai` isn't installed, `calle_client.py` talks
  directly to `POST {CALLE_API_BASE}/v1/calls` (creates the call, with an
  `Idempotency-Key` header) and polls `GET {CALLE_API_BASE}/v1/calls/{id}`
  until `task_completed` is true. `CALLE_API_BASE` defaults to
  `https://api.heycall-e.com`.
- CALL-E has no native `disposition` field — both paths pass a
  `result_schema` (see `DISPOSITION_RESULT_SCHEMA` in `calle_client.py`)
  asking CALL-E to extract `disposition`/`reason` from the conversation.
  A call that never reaches a human at all (no answer, busy, declined,
  voicemail — any terminal status other than `COMPLETED`) is mapped
  straight to `NO_ANSWER` without looking at the structured result, since
  there was no one to ask.

Not independently verified beyond those two pages: the exact `calle-ai`
PyPI version, and whether `create_and_wait` accepts an idempotency-key
argument — ForgeGate's own app-level idempotency check
(`audit_log.has_existing_call`, enforced in `app.py`) is the real safety
net either way, so this doesn't matter for correctness here.

To place one real, disclosed, consented self-test call:

1. `pip install calle-ai` (optional — the REST fallback works without it).
2. Set `CALLE_DRY_RUN=false`, `CALLE_API_KEY`, and `CALLE_RECIPIENT_PHONE`
   (your own number — never someone else's) in `.env`.
3. Restart the server and POST `scenarios/high_risk.json` again (via the
   dashboard's patch key, `scripts/trigger_scenario.py`, or curl).

Phone numbers are never hardcoded or committed — `CALLE_RECIPIENT_PHONE` is
read from the environment, and the sample scenario/audit files never contain
a real number.

## Side effects

- **Dry-run (default):** none. No network calls to CALL-E, no phone rings.
  Only local file writes to `data/audit_log.jsonl`.
- **Live (`CALLE_DRY_RUN=false`):** places a real outbound call via CALL-E to
  `CALLE_RECIPIENT_PHONE` and may (if the disposition resolves to `APPROVE`)
  flip a simulated action to `EXECUTED` in the audit log. No real
  hardware/IAM/cloud action is ever taken — `EXECUTED` and `HELD` are both
  simulated states for demo purposes.

## Idempotency & cancellation

Each incident gets a deterministic idempotency key
(`sha256(incident_id)[:16]`). If `/incident` is POSTed again for an
`incident_id` that already has a call on record, ForgeGate returns the
existing result instead of dispatching a second call — a retry or
double-trigger can't place two calls for the same incident.

There is no separate "cancel a call" endpoint: CALL-E calls in this app are
short, single-task calls (approve/hold/escalate), not long-running
processes. To stop testing, stop the server (`Ctrl+C`); no in-flight state
is left on CALL-E's side beyond the call CALL-E itself already completed or
is completing.

## Safety notes

- **Fail-closed everywhere.** `resolve_action_state` in `calle_client.py`
  only returns `EXECUTED` for a disposition of exactly `APPROVE`. `HOLD`,
  `ESCALATE`, `NO_ANSWER`, `UNCLEAR`, a poll timeout, and a dispatch
  failure all resolve to `HELD`. Nothing defaults to executing on
  ambiguity.
- **No real physical/cloud action is ever taken.** The action gate only
  writes `EXECUTED`/`HELD` to the audit log — see Non-goals in the PRD.
- **Self-test only.** `CALLE_RECIPIENT_PHONE` should always be your own,
  disclosed, consented number during development and the recorded demo.

## Project layout

```
apps/python/forgegate/
├── app.py                # FastAPI: POST /incident, GET /incidents[/{id}], GET /scenarios, GET /health, serves static/
├── risk_engine.py         # threshold scoring (+ correlation fallback)
├── task_composer.py       # incident payload -> CALL-E task string
├── calle_client.py        # place_call (SDK or REST) + idempotency + fail-closed mapping
├── audit_log.py            # JSONL audit trail
├── static/                 # "The Manual Exchange" dashboard (plain HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── scenarios/
│   ├── high_risk.json      # Scenario A: crosses threshold, triggers a call
│   └── low_risk.json       # Scenario B: stays under threshold, auto-clears
├── scripts/
│   └── trigger_scenario.py # demo convenience: POST a scenario file
└── tests/
    ├── test_risk_engine.py
    ├── test_task_composer.py
    ├── test_calle_client.py
    ├── test_audit_log.py
    └── test_app.py
```

## Running tests

```bash
cd apps/python/forgegate
pytest
```

All tests run in dry-run mode and never place a real call or hit the
network.
