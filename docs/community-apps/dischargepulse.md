# DischargePulse

An autonomous post-acute placement agent for hospital discharge planning that uses CALL-E as its telephone actuator: it calls skilled nursing facility admissions lines, verifies each care requirement from the structured result, detects when a facility contradicts its directory record, re-plans, and stops at a human approval gate.

- Repository: [https://github.com/Temake/DischargePulse](https://github.com/Temake/DischargePulse)
- License: MIT

DischargePulse is hosted in its own repository. It is not a CALL-E SDK and does not define a supported application API. It is an audit-ready prototype that runs on synthetic, de-identified data only.

## Overview

Finding a skilled nursing bed for a discharged patient means phoning facility after facility to check insurance, bed availability, and clinical capabilities such as wound VAC therapy or IV antibiotics. DischargePulse runs that search as a closed `Plan → Act → Observe → Reason → Re-Plan` loop:

- **Plan** ranks facilities inside a search radius and prunes those the directory lists as out of network.
- **Act** places concurrent CALL-E calls with a goal-shaped task and a runtime `result_schema`, so each call returns typed JSON such as `wound_vac: "yes" | "no" | "unknown"`.
- **Reason** marks a hard requirement as met only when it is explicitly confirmed, flags contradictions between the call and the directory, and scores candidates.
- **Re-Plan** queues a sister facility named on the call, widens the radius, or stops early on a verified match.
- The run ends at a **human gate**: a case manager approves or declines a proposed placement, and a referral packet PDF records the decision.

An optional LLM transcript review (Claude, on the Claude API or Amazon Bedrock) can only make a finding more cautious, and only with a verbatim quote of the facility's own words; code applies or rejects each flag. It never confirms a requirement or approves a placement.

## Setup

Requirements: Python 3.10+. Node.js 18+ only for the optional web console.

```bash
git clone https://github.com/Temake/DischargePulse.git
cd DischargePulse
cp .env.example .env            # defaults are safe: TELEPHONY_MODE=replay

cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install --only-binary=:all: -r requirements.txt
```

Try the whole agent loop with no calls placed:

```bash
python scripts/run_placement.py --case 10482 --mode scripted --packet packet.pdf
```

Run the API server locally:

```bash
python -m uvicorn app.main:app --port 8000
```

Full instructions, the API reference, and test commands are in the repository README.

## CALL-E integration method

DischargePulse uses the official CALL-E Python SDK (`calle-ai`): `CalleClient` and `calls.create_and_wait`, with a `result_schema` built at runtime from the patient's hard requirements and recipient `region`/`locale` derived from the destination number. All CALL-E access is isolated in one actuator module behind a telephony interface, so the planner, reasoning engine, and console behave identically in every mode.

| Mode | Calls placed | Where the facility's answers come from |
| --- | --- | --- |
| `replay` (default) | None | A recorded call, replayed from a local cassette |
| `scripted` | None | A labelled test scenario |
| `live` | Real CALL-E calls | Extracted from the call |
| `simulated` | Real CALL-E calls | Extracted from the call; a labelled test scenario only when the call returned no usable answers |

Every observation carries two independent labels, `mode` and `answers_source`, and they are shown in the console, the event stream, and the referral packet. Simulated answers never overwrite answers the call actually produced, and nothing is simulated on top of a call that did not connect.

## Call side effects

In `live` and `simulated` modes each run places real outbound calls through CALL-E to the configured demo lines. Each call can ring a phone and consumes CALL-E credit. CALL-E may make more than one dial attempt for a single call task.

The app places at most one call task per facility per run and does not retry or redial a facility within a run. There are no background schedulers and no recurring jobs.

The referral packet PDF is generated locally and is **never transmitted**: e-fax dispatch and transport coordination are not implemented, and the packet states this.

When an LLM provider is configured, the synthetic call evidence for each facility is sent to it for review: the Claude API (`LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`) or Claude on Amazon Bedrock (`LLM_PROVIDER=bedrock` with `AWS_REGION` and a Bedrock API key or AWS credentials). Without one, the review is skipped and the rule-based agent runs unchanged.

## Safe testing path with no calls

`TELEPHONY_MODE=replay` is the committed default, and the `scripted` and `replay` modes never place a call. The automated test suite runs without network access to CALL-E or Claude.

A real call requires all of the following:

1. A call-placing mode chosen explicitly for the run: `--mode live` or `--mode simulated` on the CLI, or `"mode": "live" | "simulated"` in the API request. The single-call smoke test and cassette recorder additionally require `--execute`.
2. `CALLE_API_KEY` is set.
3. The facility has a configured demo line; directory entries with placeholder numbers are refused.
4. The destination is a valid E.164 number in CALL-E's coverage table.
5. The persisted call budget ledger has headroom (`CALL_BUDGET`). A reservation is taken before dialing and is refunded only when CALL-E rejects the request before placing a call.

The API additionally requires a `max_calls` ceiling on call-placing runs, refuses a run that could exceed the remaining budget, and refuses a request for real calls, rather than silently replaying, when credentials are missing.

## Credential handling

CALL-E, Anthropic, and AWS credentials are read from environment variables only. They are never committed, never written to recordings or reports, and never returned by the API. The repository ships a `.env.example` with empty values, and `.env` is excluded by `.gitignore`.

The API server has no authentication and is meant for a single local operator. Run it on `localhost`, as in the setup above, and do not expose it on a network interface.

## Cancellation and duplicate-call protections

- Only one call-placing run may be in flight at a time.
- A run never calls the same facility twice.
- `max_calls` and the persisted budget ledger bound the number of calls.
- There is no cancel action for a run in progress. Stopping the backend cancels in-flight runs, but a call already submitted to CALL-E may still complete, and closing the console does not stop a run.
- Nothing is sent after a match: the run stops at the approval gate, and approval only records a decision and regenerates the local packet.
- There are no recurring schedules to cancel.

## Phone-number handling

Destinations are validated as E.164 and routed by calling code. Phone numbers are masked, for example `+15******100`, in API responses, the event stream, recorded cassettes, the budget ledger, logs, and CLI output; the full number is kept in memory only to place the call. Test fixtures use fictional numbers. The demo lines are CALL-E's organiser-published testing hotline and the developer's own CALL-E inbound number.

## Boundaries

DischargePulse is a placement-logistics prototype, not a clinical decision tool. It uses synthetic, de-identified patients and invented facilities, and the voice agent is instructed not to state or accept patient identifiers. Calls gather availability only: the agent may not agree to or schedule an admission, and it gives no clinical advice. Placement is always a human decision. Calls are directed only at demo lines the developer controls or is authorized to call, never at real clinical staff.

## Known limitations

- The stand-in facility line currently answers live calls without audio, a platform issue reported to the CALL-E organisers, so real-call demos use labelled simulated attendant answers.
- Run history is held in memory and is cleared when the backend restarts.
