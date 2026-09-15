# BuddyE

**Hazard-triaged welfare-check calls over CALL-E.** When a heat warning, power outage, flood, cold snap or smoke event hits, a volunteer block captain has a list of vulnerable neighbours and one evening. BuddyE ranks that list against the specific hazard, calls every person worst-first, understands what they said, escalates the ones who need it (including the ones who never picked up), and sends help. A volunteer with water goes automatically. An ambulance is prepared, routed and justified, then waits for a named human.

![BuddyE architecture: hazard triage, CALL-E sweep where silence flows into decide(), escalation ladder and dispatch that stop at a named human](docs/architecture.svg)

## What it does

1. **Triage.** Every neighbour is scored against *this* hazard with readable rules (`backend/app/domain/risk.py`), each point carrying the sentence that justifies it. People who never consented to check-in calls stay on the board but are never dialled.
2. **Call.** Each neighbour gets a CALL-E call whose `result_schema` is compiled from the hazard: the facts that hazard makes non-negotiable (is the cooler running, how long does the oxygen battery last) become required fields.
3. **Understand.** The structured result is validated locally against the exact schema sent. An optional LLM pass looks only at fields that came back invalid or `unknown`, and can never overturn a definite answer.
4. **Decide.** A deterministic `decide()` turns every call, including silence, into one of five outcomes.
5. **Escalate.** Anything not `SAFE` climbs a three-rung ladder that ends at a prepared handoff packet, never at an emergency service.
6. **Dispatch.** Each escalation becomes an incident at an address. Community help is sent automatically; agency units stay proposed until a person approves them.

### Why the hazard matters

Two seeded neighbours show it. **Rosa Delgado** (75+, lives alone) cools her house with a swamp cooler, which barely works in monsoon humidity, so under a heat warning she is the most endangered person on the block, and she will say three times that she is fine. **Walter Brzezinski** runs an oxygen concentrator with four hours of battery: one of several people who matter under a heat warning, but first on the list during a six-hour outage, because his machine stops two hours before the power returns. Same fourteen people, different hazard, different call order.

## Outcomes

| Outcome | Meaning | What happens |
| --- | --- | --- |
| `SAFE` | Reached them; nothing is needed | Recorded, no escalation |
| `HELP_DECLINED` | They need something and said no thank you | Escalation opens at the captain's board |
| `NEEDS_HELP` | They accepted a specific offer of help | Escalation and a community dispatch |
| `URGENT` | Something is wrong right now (unsafe, equipment stopped, distressed) | The ladder climbs; handoff packet at high bands |
| `UNREACHABLE` | Nobody answered, the call failed, or nothing usable came back | The ladder climbs; at the critical band this outranks `URGENT` |

Silence is a finding, not a gap: `NO_ANSWER`, `FAILED` and `INVALID_RESULT` are inputs to `decide()` with the neighbour's risk attached. Every sweep ends by naming everyone left without an outcome and why (`sweep.unaccounted`).

## Escalation and human authorisation

| Rung | Who | What BuddyE may do |
| --- | --- | --- |
| `EMERGENCY_CONTACT` | the person the neighbour nominated | call them |
| `BLOCK_CAPTAIN` | the volunteer running the sweep | notify on the board |
| `RESPONDER` | 911 / an agency | prepare a handoff packet and stop |

- `orchestrator/escalate.py` imports no call provider. A `HandoffPacket` is written with `released_at = None`, and only `release()` sets it, with a human name (empty names and `system`, `bot`, `automation` and similar are refused).
- Dispatch follows the same rule. `commit()` refuses `EMS_UNIT`, `FIRE_UNIT` and `POLICE_WELFARE`; `authorise()` is the only way out of `PROPOSED` and uses the same name validator. Declines are recorded with a name and a reason.
- The call task tells the voice agent it cannot summon anyone and must tell a person in danger to dial 911 themselves.

## Dispatch and the map

Twelve seeded units at real Maryvale staging points:

| Community resources (committed automatically) | Agency units (proposed until a named human approves) |
| --- | --- |
| wellness vans, volunteer drivers, water and ice truck, cooling shuttle, power cart, nurse outreach | ambulances (`EMS_UNIT`), fire engine (`FIRE_UNIT`), patrol unit (`POLICE_WELFARE`) |

`domain/fleet.py` decides who could legally take an incident (available, capable, in radius, and agency units only when the incident justifies one), ranks the candidates, and re-validates the pick against live rows. Three optional operator agents write a one-sentence dispatch rationale, ICS-214/213 paperwork and correspondence drafts. **Code filters, the model ranks or writes, code validates**: every failure path returns the deterministic answer, every agent call is logged as an `OperatorAction`, drafts are never marked sent and documents are never signed. Vehicle positions are server state advanced along the route the ETA was measured on (`sim/movement.py`, the only simulated part).

## The console

| Route | Page |
| --- | --- |
| `/hazards/:hazardId` | Operations: the live map and deployments being watched |
| `/hazards/:hazardId/sweep` | The board: every neighbour worst-first, outcomes, and the unaccounted list |
| `/hazards/:hazardId/sweep/:neighbourId` | One person's case: triage reasons, calls and transcripts, the ladder, handoff packets, and the call button |
| `/hazards/:hazardId/incidents` | Incidents and dispatches, including agency units waiting for a named human |
| `/hazards/:hazardId/approvals` | What was authorised or declined, and by whom |
| `/hazards/:hazardId/fleet` | Every unit, its position, route and ETA |

The console follows one hazard over a server-sent event stream with replay (`GET /api/stream/hazards/{id}`), so a laptop that sleeps comes back to a correct board.

## Quick start

```bash
# backend (Python 3.11+)
cd backend && uv venv && uv pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# frontend (Node 22), proxies /api to 127.0.0.1:8000
cd frontend && npm install && npm run dev

# tests: mock provider and fake clients only, no network, no phones
cd backend && .venv/bin/python -m pytest -q     # 499 passed
```

No `.env` is needed. Defaults fail closed (`CALL_PROVIDER=mock`, empty allowlist, four-call budget), and the database seeds itself with fourteen fictional neighbours and a heat warning. `./demo.sh` starts both halves and prints the URL to open.

**Demo walkthrough:** open the board, start the sweep, and watch triage, calls, outcomes and escalations arrive live. `POST /api/demo/outage` then declares a power cut over the same roster and the order changes (Walter goes from 87 to 100, critical, 4.0 h to harm). The seeded heat sweep ends with:

```text
roster 14 · queued 13 (Gerald Pryce never opted in) · 18 calls (13 neighbours + 5 emergency contacts)
URGENT 3 · UNREACHABLE 3 · NEEDS_HELP 3 · HELP_DECLINED 1 · SAFE 3
escalations 10 · handoff packets prepared 3 · released 0 · emergency services contacted 0
```

Run tests in a shell without real `DEMO_PHONE_*` values; the fixtures pin that every seeded number is unroutable.

## Configuration

Every setting is listed in [`backend/.env.example`](backend/.env.example). The ones that change behaviour:

| Setting | Default | Effect |
| --- | --- | --- |
| `CALL_PROVIDER` | `mock` | `mock`, `calle_sdk` (Developer API) or `calle_mcp` (CLI) |
| `DIALABLE_NUMBERS` | empty | Strict ASCII E.164 allowlist for real calls |
| `CALL_BUDGET_MAX` | `4` | Hard cap on real calls for this database |
| `CALL_EMERGENCY_CONTACTS` | `true` | Whether the ladder may call a nominated contact |
| `HANDOFF_MIN_BAND` | `high` | Lowest triage band that gets a handoff packet |
| `AUTO_DISPATCH` | `true` | Commit community resources automatically (agency units stay `PROPOSED` either way) |
| `TOKENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | empty | Optional inference; without either, unknowns stay unknown and agents use deterministic fallbacks |
| `OVERSEER_NAME` | empty | "Prepared by" on paperwork; can never authorise anything |

## Real calls

Real calls ring real phones and spend CALL-E credits. BuddyE is a **local operator tool**: keep the backend on `127.0.0.1` and never put the console behind a tunnel, reverse proxy or port-forward.

1. Get and record consent from everyone you will call.
2. In `backend/.env`, set `CALL_PROVIDER=calle_sdk` and `CALLE_API_KEY`. Put the demo numbers in `DEMO_PHONE_A/B/C` (Rosa, Walter, Ernesto) and the same numbers in `DIALABLE_NUMBERS` as strict ASCII E.164 (`+15550100` style). Set `CALL_BUDGET_MAX` to what you are willing to spend. Leave `CALLE_BASE_URL` unset.
3. Run `backend/scripts/live_preflight.py`. It checks the configuration, allowlist, budget and the compiled contract without placing a call.
4. `POST /api/demo/reset` so the seed picks up the numbers, then start a sweep. Polling completes every call. For the optional webhook, expose only `POST /api/calle/webhook/{token}` and set `PUBLIC_BASE_URL` (HTTPS) plus a fixed `CALLE_WEBHOOK_SECRET`.

## Safety summary

Enforced in code, with no setting that disables it:

- **Local-only API.** The console has no login, so every endpoint except the CALL-E webhook returns `403` unless the peer and `Host` are loopback, no forwarding header (`X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`, …) is present, and any browser `Origin` is loopback (`app/api/local_only.py`).
- **Authorised recipients only.** A real provider dials only strict ASCII E.164 numbers listed in `DIALABLE_NUMBERS`; anything else is `call.skipped` before the dial, and a malformed entry stops startup. Emergency contacts never get a real number from the environment. Consent is checked again at the moment of dialling.
- **Pinned credential destination.** The CALL-E key is sent only to `https://api.heycall-e.com`; any other `CALLE_BASE_URL` stops startup and is refused before a keyed client exists. `calle_mcp` sends no key from this process.
- **A budget that cannot be overshot.** `CALL_BUDGET_MAX` is checked before every dial and counts accepted calls, calls still in flight, and calls of unknown outcome, so calls started at the same moment cannot all squeeze under it. The `SpentCall` ledger survives a demo reset.
- **Unknown outcomes stop everything.** A create that times out, loses its connection, returns 5xx/408 or no call id, or a poll that passes its deadline, is recorded `UNKNOWN`. It never reaches `decide()`: no escalation, no further dial, and the sweep ends `FAILED` (terminal, not resumed on restart). The person is listed as `outcome_unknown` and is not rung again from this database until someone checks the call in CALL-E. A restart that finds a dial with no provider id marks it `UNKNOWN` instead of re-sending it; only a definite `4xx` is reported as "no call was placed".
- **Idempotency before the dial.** The key is written to the database first and reused on restart, so a crash cannot ring anyone twice.
- **Defensive webhooks.** CALL-E webhooks are unsigned, so the receiver uses a random path token, requires `CALL-E-Event-Id` to match the body id, deduplicates, and re-fetches the call from the API before acting.
- **No software contacts an emergency service**, and no agency unit leaves `PROPOSED` without a named human (see above).
- **Health data is redacted at egress.** `app.obs.redact` masks phone numbers and credential-shaped values in logs, events and API responses, and operator-agent prompts are redacted before they leave the process. The call task uses derived facts and first names only, and says nothing about health on voicemail. Every seeded person is fictional and every committed number is an unroutable `+1 555-01xx`.

## CALL-E integration

| Provider | Surface | Behaviour |
| --- | --- | --- |
| `calle_sdk` | `calle-ai` SDK: `calls.create` with `result_schema`, `metadata`, `idempotency_key` | Persists the call id, polls `calls.get` and `calls.list_events` into the timeline; a verified webhook short-circuits the poll |
| `calle_mcp` | `calle` CLI: `call plan` → `call run` → `call status` | Goal-based with no typed result; the reconcile step reads fields from the transcript |
| `mock` (default) | none | Fourteen scripted conversations, overlaid per hazard |

`structured_result: null` is treated as `INVALID_RESULT`. The schema compiler stays inside the documented subset (no nullable type arrays, every enum carries `unknown`), enforced by `assert_calle_schema_subset()`. A low `completion_confidence` removes `SAFE` rather than overturning what was said.

## Architecture

```text
backend/app/
  domain/risk.py, hazards.py        hazard-conditioned triage; no model
  calls/contract.py                 hazard + neighbour -> spoken task + CALL-E result_schema
  calls/calle_sdk.py, calle_mcp.py, mock.py   three providers behind one interface
  calls/budget.py, guards.py        E.164 allowlist, hard call cap, pinned CALL-E origin
  orchestrator/runner.py            sweep driver; state lives in SQLite, the coroutine only pushes it forward
  orchestrator/decide.py            one call -> one outcome; pure and deterministic
  orchestrator/escalate.py          the ladder and handoff packets; no provider import
  orchestrator/reconcile*.py        optional LLM pass on failing fields only
  orchestrator/incidents.py, dispatch.py, domain/fleet.py   incidents, dispatch state machine, eligibility
  agents/                           operator agents with deterministic fallbacks
  api/                              REST + SSE; api/local_only.py guards every endpoint
  events/bus.py, obs.py             DB-backed event log with replay; redaction at egress
frontend/                           Vite + React + Tailwind + Leaflet console
```

## Documentation

| Doc | Covers |
| --- | --- |
| [`docs/TRIAGE.md`](docs/TRIAGE.md) | Hazard profiles and the scoring rules |
| [`docs/CALL-CONTRACT.md`](docs/CALL-CONTRACT.md) | The spoken task, the result schema and extraction guidance |
| [`docs/ESCALATION.md`](docs/ESCALATION.md) | The outcome table and the ladder |
| [`docs/DISPATCH.md`](docs/DISPATCH.md) | Resources, the dispatch engine and the authorisation boundary |
| [`docs/MAP.md`](docs/MAP.md) | What on the map is real and what is simulated |
| [`docs/API.md`](docs/API.md) | Routes and the SSE event contract |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The console's UI contract |

The portable rules (hazard-conditioned triage, the welfare contract, reading under-reported distress, the ladder and the authorisation boundary) are packaged as the [`neighbour-welfare-sweep`](../../../skills/neighbour-welfare-sweep/) skill.
