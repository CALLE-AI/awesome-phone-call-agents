# BuddyE

**When a heat warning or power outage hits, a volunteer block captain has a list of vulnerable neighbours and one evening. BuddyE ranks that list against the specific hazard, calls every person on it worst-first over CALL-E, treats an unanswered call as a finding that escalates, and sends help. A volunteer with water goes automatically. An ambulance is prepared, routed and justified, then waits for a named human.**

![BuddyE architecture: hazard triage, CALL-E sweep where silence flows into decide(), escalation ladder and dispatch that stop at a named human](docs/architecture.svg)

Two seeded neighbours show why the order matters. **Rosa Delgado** (75+, lives alone) cools her house with a swamp cooler, which barely works in monsoon humidity, so under a heat warning she is the most endangered person on the block, and she will say three times that she is fine. **Walter Brzezinski** runs an oxygen concentrator with four hours of battery. Under the heat warning he is one of several; during a six-hour outage his machine stops two hours before the power returns. Same fourteen people, different hazard, different call order, computed by readable rules in `backend/app/domain/risk.py`, not by a model.

## How a sweep works

```text
POST /api/hazards/{id}/sweep
  TRIAGING    score every neighbour against THIS hazard -> call order, worst first (no consent = not called)
  CALLING     for each neighbour, to the end of the list:
                compile the contract (hazard-critical facts become required result_schema fields)
                consent + strict E.164 allowlist + call budget checked at the row, idempotency key written, then dial
                validate structured_result locally against the exact schema sent
                reconcile (optional LLM) only on fields that came back invalid or unknown
                decide() -> SAFE | HELP_DECLINED | NEEDS_HELP | URGENT | UNREACHABLE
  ESCALATING  anything not SAFE opens an escalation and climbs the ladder
  COMPLETE    every neighbour has an outcome or is named in `unaccounted`, with the reason
```

There is no early exit: only a spent budget, a provider failure that applies to everyone, or a call whose outcome is **unknown** stops the roster.

Seeded heat sweep (mock provider, no network):

```text
roster 14 · queued 13 (Gerald Pryce never opted in) · 18 calls (13 neighbours + 5 emergency contacts)
URGENT 3 · UNREACHABLE 3 · NEEDS_HELP 3 · HELP_DECLINED 1 · SAFE 3
escalations 10 · handoff packets prepared 3 · released 0 · emergency services contacted 0
```

`POST /api/demo/outage` declares a power cut over the same roster and the order changes live (Walter goes from 87 to 100, critical, 4.0 h to harm).

## The two properties it is built around

**1. Silence is a finding.** `NO_ANSWER`, `FAILED` and `INVALID_RESULT` are inputs to `decide()`, carrying the neighbour's triage assessment, and come back `UNREACHABLE`. At the critical band that outranks `URGENT` (priority 100 vs 95). A provider refusing a number is a finding about someone nobody has spoken to, not a skip. `unaccounted()` names everyone left without an outcome and why (no consent, not dialled, outcome unknown, still running).

**2. Software never contacts an emergency service.** The ladder is:

| Rung | Who | What BuddyE may do |
| --- | --- | --- |
| `EMERGENCY_CONTACT` | the person the neighbour nominated | call them |
| `BLOCK_CAPTAIN` | the volunteer running the sweep | notify on the board |
| `RESPONDER` | 911 / an agency | prepare a handoff packet and stop |

`orchestrator/escalate.py` imports no call provider. A `HandoffPacket` is written with `released_at = None`; only `release()` sets it, and it requires a human name (it refuses empty names and `system`, `bot`, `automation` and similar). On the dispatch side, `commit()` refuses `EMS_UNIT`, `FIRE_UNIT` and `POLICE_WELFARE`; `authorise()` is the only way out of `PROPOSED` and uses the same name validator. The call task itself tells the agent it cannot summon anyone.

## Dispatch and the map

Every escalation becomes an incident at an address (`orchestrator/incidents.py`, idempotent on `escalation_id`). `domain/fleet.py` filters which of the twelve seeded units could legally take it (available, capable, in radius, and agency units only when the incident justifies one), ranks them, and re-validates the choice. Community resources are committed automatically (`AUTO_DISPATCH`); agency units stay `PROPOSED` until a named human approves or declines with a reason.

Three optional operator agents (TokenRouter) write a one-sentence dispatch rationale, ICS-214/213 paperwork and correspondence drafts. **Code filters, the model ranks or writes, code validates**, and every failure returns the deterministic answer. Each agent call is logged as an `OperatorAction`, including calls where the model was never reached. Drafts are never marked sent and documents are never signed.

Vehicle positions are server state advanced along the same route the ETA was measured on (`sim/movement.py`, the only simulated part). See [`docs/MAP.md`](docs/MAP.md).

## Architecture

```text
backend/app/
  domain/risk.py, hazards.py   hazard-conditioned triage with a sentence per point; no model
  calls/contract.py            hazard + neighbour -> spoken task + CALL-E result_schema (documented subset)
  calls/calle_sdk.py, calle_mcp.py, mock.py   three providers behind one interface
  calls/budget.py, guards.py   E.164 allowlist, hard call cap, pinned CALL-E origin
  orchestrator/runner.py       sweep driver; state lives in SQLite, the coroutine only pushes it forward
  orchestrator/decide.py       one call -> one outcome; pure and deterministic
  orchestrator/escalate.py     the ladder and handoff packets; no provider import
  orchestrator/reconcile*.py   optional LLM pass on failing fields only; never overturns a definite answer
  orchestrator/incidents.py, dispatch.py, domain/fleet.py   incidents, the dispatch state machine, eligibility
  agents/                      operator agents; every path has a deterministic fallback
  api/                         REST + SSE; api/local_only.py guards every endpoint
  events/bus.py, obs.py        DB-backed event log with replay; redaction on everything that leaves the process
frontend/                      Vite + React + Tailwind + Leaflet console
docs/                          API, TRIAGE, CALL-CONTRACT, ESCALATION, DISPATCH, MAP, DESIGN
```

A restarted sweep re-attaches to the `CheckCall` rows it already wrote, reusing each idempotency key, instead of ringing anyone twice.

## Run it

```bash
# backend (Python 3.11+)
cd backend && uv venv && uv pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# frontend (Node 22), proxies /api to 127.0.0.1:8000
cd frontend && npm install && npm run dev

# tests: mock provider and fake clients only, no network, no phones
cd backend && .venv/bin/python -m pytest -q     # 497 passed
```

No `.env` is needed: defaults fail closed (`CALL_PROVIDER=mock`, empty allowlist, four-call budget) and the database seeds itself with fourteen fictional neighbours and a heat warning. See [`backend/.env.example`](backend/.env.example) for every setting. Run tests in a shell without real `DEMO_PHONE_*` values; the fixtures pin that every seeded number is unroutable.

| Setting | Default | Effect |
| --- | --- | --- |
| `TOKENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | empty | Optional inference. Without either, unknowns stay unknown and agents use their deterministic fallbacks. |
| `AUTO_DISPATCH` | `true` | Commits community resources automatically. Agency units stay `PROPOSED` either way. |
| `CALL_EMERGENCY_CONTACTS` / `HANDOFF_MIN_BAND` | `true` / `high` | Whether the ladder may call a nominated contact; the lowest band that gets a handoff packet. |
| `OVERSEER_NAME` | empty | "Prepared by" on paperwork. It can never authorise anything. |

## Security and real calls

**Local-only.** The console has no login, and the API starts calls, releases handoffs, authorises dispatches and returns health records and transcripts, so the backend only serves this machine (`app/api/local_only.py`). Every endpoint except the CALL-E webhook returns `403` unless the peer and `Host` are loopback, no forwarding header (`X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`, …) is present, and any browser `Origin` is loopback. No setting turns this off. Keep uvicorn on `127.0.0.1` and never put the console behind a tunnel, reverse proxy or port-forward.

**Going live** (real calls cost credits and ring real phones):

1. Get and record consent from everyone you will call.
2. In `backend/.env`: `CALL_PROVIDER=calle_sdk`, `CALLE_API_KEY`, `DEMO_PHONE_A/B/C` (Rosa, Walter, Ernesto), the same numbers in `DIALABLE_NUMBERS` as strict ASCII E.164 (`+15550100` style), and `CALL_BUDGET_MAX`. Leave `CALLE_BASE_URL` unset.
3. `POST /api/demo/reset` so the seed picks up the numbers, then start a sweep. Polling completes every call; no tunnel is needed. For the optional webhook, expose only `POST /api/calle/webhook/{token}` and set `PUBLIC_BASE_URL` (HTTPS) plus a fixed `CALLE_WEBHOOK_SECRET`.
4. `backend/scripts/live_preflight.py` checks all of this without placing a call.

What is enforced in code, with no switch to disable it:

- **Recipients.** A real provider dials only strict ASCII E.164 numbers listed in `DIALABLE_NUMBERS`; anything else is `call.skipped` before the dial. A malformed entry stops startup. Emergency contacts never get a real number from the environment.
- **Credentials.** The CALL-E key is sent only to `https://api.heycall-e.com`; any other `CALLE_BASE_URL` stops startup and is refused before a keyed client exists. `calle_mcp` sends no key from this process.
- **Budget.** `CALL_BUDGET_MAX` is checked before every dial and ends the sweep `BUDGET_EXHAUSTED`. The `SpentCall` ledger survives a demo reset.
- **Idempotency and consent.** The idempotency key is written before the dial and reused on restart. Consent is checked again at the moment of dialling.
- **Unknown outcomes stop everything.** A create that times out, loses its connection, returns 5xx/408 or no call id, or a poll that passes its deadline, is recorded `UNKNOWN`. It never reaches `decide()`: there is no escalation, no further dial, and the sweep ends `FAILED` (terminal, not resumed on restart). The person is listed as `outcome_unknown` and is not rung again from this database; check the call in the CALL-E dashboard. A restart that finds a dial with no provider id marks it `UNKNOWN` instead of re-sending it. Only a definite `4xx` refusal is reported as "no call was placed".
- **Webhooks** are unsigned in current CALL-E, so the receiver uses a random path token, requires `CALL-E-Event-Id` to match the body id, deduplicates, and re-fetches the call from the API before acting.

## CALL-E integration

| Provider | Surface | Behaviour |
| --- | --- | --- |
| `calle_sdk` | `calle-ai` SDK: `calls.create` with `result_schema`, `metadata`, `idempotency_key` | Persists the call id, polls `calls.get` and `calls.list_events` into the timeline; a verified webhook short-circuits the poll. |
| `calle_mcp` | `calle` CLI: `call plan` → `call run` → `call status` | Goal-based, no typed result; the reconcile step reads fields from the transcript. |
| `mock` (default) | none | Fourteen scripted conversations, overlaid per hazard. |

`structured_result: null` is treated as `INVALID_RESULT`, and results are validated locally with `jsonschema` against the schema that was sent. The schema compiler stays inside the documented subset (no nullable type arrays, every enum carries `unknown`), enforced by `assert_calle_schema_subset()`. A low `completion_confidence` removes `SAFE` rather than overturning what was said. Details: [`docs/CALL-CONTRACT.md`](docs/CALL-CONTRACT.md), [`docs/API.md`](docs/API.md).

## Health data

Conditions, power dependency, access notes and addresses are sensitive. They are redacted at egress, not at the source: `app.obs.redact` masks phone numbers and credential-shaped values in logs, events and API responses, and operator-agent prompts are redacted before they leave the process. The call task is built from derived facts only (power-dependent, mobility, lives alone), uses first names, and says nothing about health on voicemail. Handoff packets keep the address and medical dependency because that is their purpose. Every seeded person is fictional and every committed number is an unroutable `+1 555-01xx`.

The portable rules (hazard-conditioned triage, the welfare contract, reading under-reported distress, the ladder and the authorisation boundary) are packaged as the [`neighbour-welfare-sweep`](../../../skills/neighbour-welfare-sweep/) skill.
