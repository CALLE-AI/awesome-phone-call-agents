# CallSentinel design reference

A documentation-only design for an AI-agent phone-call monitoring layer that would
flag possible spam/scam signals in transcripts and return advisory incident reports
through an MCP-style interface. **No runnable application or analysis implementation
is included in this repository contribution.** The interfaces and architecture below
describe the proposed workflow, not installed tools or verified runtime behavior.

The author provides an [external demo link](https://call-sentinel.vercel.app).
Its availability, implementation, and safety properties are not independently
verified here. Do not submit credentials, real contact details, private transcripts,
or recordings to an external demo; use synthetic text only.

## Proposed workflow

The design proposes 11 rule-based heuristics over a call transcript to surface
common consumer-protection scam signals (urgency pressure, SSN or payment-card
requests, wiring or crypto demands, warranty-scam language, impersonation, arrest
threats, advance-fee bait, unauthorized data requests, robotic scripts), combine
them into a 0-100 risk score, assign an advisory label, and emit a human-readable
incident report with masked phone numbers.

The intended phone-call workflow is for an agent host or human reviewer to supply
a transcript from an authorized call and receive flags for manual review. Such
heuristics can miss scams or flag legitimate speech; they are not a verified fraud
determination and must not automatically trigger consequential actions. Live
calling is outside the proposed monitoring layer's scope.

## Proposed MCP tools

| Tool | Purpose |
| --- | --- |
| `analyze_call_transcript` | Run anomaly detection over a transcript; return flags, risk score, verdict. |
| `generate_incident_report` | Build a masked incident report and persist it to the audit log. |
| `list_anomaly_heuristics` | Return the catalog of detection rules (id, label, base score). |
| `list_incidents` | Return recent incidents from the audit log, newest first. |
| `get_incident` | Fetch a single incident by `call_id`. |
| `run_demo_analysis` | Run the seeded demo (one scam call, one clean call). |
| `agent_status` | Return runtime status: tool count, heuristic count, version. |

The proposed discovery endpoint is `GET /mcp/tools`, with invocation at `POST /mcp/call` using
`{"name": "<tool>", "arguments": {...}}`.

## Proposed demo endpoints

- `GET /` — dashboard UI
- `GET /api/health` — health check
- `GET /api/demo` — run the seeded demo (scam and clean call side by side)
- `GET /api/agent/status` — agent runtime status
- `GET /api/incidents` — recent incidents
- `GET /mcp/tools` — MCP tools/list
- `POST /mcp/call` — MCP tools/call

## How to use this reference

Read the workflow and interface tables as an integration sketch. There is no local
server, dependency installation, or executable quick start in this contribution.
An implementer would need to supply the heuristics, input validation, report
generation, routes, storage, and tests before offering a runnable app.

For a manual design walkthrough, use an invented conversation: compare a routine
appointment confirmation with a fictional request for a gift-card payment. Identify
which proposed rules should flag each conversation and inspect whether the proposed
report distinguishes evidence from inference. This is a paper exercise, not a test
of a bundled classifier.

## Safety requirements for an implementation

- Keep demonstrations synthetic and no-call by default; require no live credentials.
- Validate phone inputs as E.164 and mask real phone numbers in reports, structured
  results, and errors; do not claim perfect transcript redaction from a phone masker.
- Use fictional fixtures and minimize retained text. An endpoint handling private
  transcripts or reports needs authentication and authorization.
- Do not create hidden recurring work, retries, or external actions from risk labels.
- Document cancellation and retention behavior for the implementation. This static
  guide starts no process, schedules no work, and has nothing to cancel or roll back.

## Scope and verification limits

- **Included:** this design guide, proposed tool/endpoint tables, and a manual
  synthetic walkthrough.
- **Not included or verified here:** heuristic code, risk scoring, masking, MCP
  dispatch, FastAPI routes, a SQLite audit log, tests, or live telephony transport.
- **External demo:** author-provided resource only, not a certification of its
  architecture, safety, accuracy, or production readiness.

## Proposed architecture

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
