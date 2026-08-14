# CallSentinel

An AI phone-call agent that monitors call quality, detects spam/scam anomalies in
call transcripts, scores risk, and generates structured incident reports. Exposes
its capabilities as MCP tools so any MCP-compatible agent host can discover and
invoke them. **Dry-run / fixture mode only — no live calls are placed.**

A deployed demo is available at <https://call-sentinel.vercel.app>.

## What it does

CallSentinel applies 11 rule-based heuristics to a call transcript to surface
common consumer-protection scam signals (urgency pressure, SSN or payment-card
requests, wiring or crypto demands, warranty-scam language, impersonation, arrest
threats, advance-fee bait, unauthorized data requests, robotic scripts), combines
them into a 0-100 risk score, assigns a verdict, and emits a human-readable incident
report with masked phone numbers.

It is built for the "phone call agent" workflow: an agent host (or a human reviewer)
hands CallSentinel a transcript, and CallSentinel returns a verdict, a risk score,
and an auditable incident report. The agent never places a call itself — it is a
monitoring and analysis layer over calls made by other agents.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `analyze_call_transcript` | Run anomaly detection over a transcript; return flags, risk score, verdict. |
| `generate_incident_report` | Build a masked incident report and persist it to the audit log. |
| `list_anomaly_heuristics` | Return the catalog of detection rules (id, label, base score). |
| `list_incidents` | Return recent incidents from the audit log, newest first. |
| `get_incident` | Fetch a single incident by `call_id`. |
| `run_demo_analysis` | Run the seeded demo (one scam call, one clean call). |
| `agent_status` | Return runtime status: tool count, heuristic count, version. |

Discover them at `GET /mcp/tools`; invoke at `POST /mcp/call` with
`{"name": "<tool>", "arguments": {...}}`.

## Demo endpoints

- `GET /` — dashboard UI
- `GET /api/health` — health check
- `GET /api/demo` — run the seeded demo (scam and clean call side by side)
- `GET /api/agent/status` — agent runtime status
- `GET /api/incidents` — recent incidents
- `GET /mcp/tools` — MCP tools/list
- `POST /mcp/call` — MCP tools/call

## Local setup

Python 3.11 or newer. Dependencies: `fastapi`, `uvicorn[standard]`, `pydantic`.

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# open http://localhost:8000
```

## Dry-run and safety

- **No calls.** There is no live transport and no `--live` flag in this edition. Every
  transcript comes from a fixture or a caller-provided payload. It cannot dial even if
  configured to.
- **No credentials.** No account, no API key, no network request of any kind.
- **No scheduler, no retry.** Analysis runs once per request. Nothing runs later or
  repeats by itself.
- **Numbers are validated as E.164 before processing** and masked in every output path
  — report, structured result and error message alike. No full number leaves the agent.
- **Fictional data only.** Fixtures use the `+1 555-0100` range, reserved for fiction
  and belonging to nobody.
- **No hidden recurring schedules.** There is no background worker, no cron, and no
  queue. Each request is independent.
- **Cancellation.** Stopping the process stops the current analysis. Nothing was
  scheduled and there is nothing to roll back.

## What is real vs mocked

- **Real:** the 11 heuristics, the risk scoring, the verdict classification, the
  incident-report generation, the number masking, the MCP tool registry and dispatch,
  the FastAPI routes, and the SQLite audit log.
- **Mocked:** no live telephony transport. Transcripts are fixtures or caller-supplied
  text. This is a monitoring and analysis layer, not a call-placing agent.

## Architecture

```
transcript -> agent.run_analysis() -> 11 heuristics -> anomaly flags
                                          |            -> 0-100 risk score
                                          v            -> verdict
                                  build_incident_report() (masked numbers)
                                          |
                                  store.save_incident()  (SQLite audit log)
                                          |
                                  MCP /mcp/tools + /mcp/call
```

## License

MIT.
