# Real Estate Buyer Follow-up Agent

A local broker-facing demo built on CALL-E. A broker supplies a follow-up goal; the agent organizes customer history, viewing records, property facts and selected business guidance, proposes a call task for approval, then turns call results into evidence-linked CRM suggestions and human follow-up recommendations.

**Current scope: Streamlit + Doubao planning/analysis + mock CRM snapshots + Mock calls by default. CRM changes are previews only.**

## What the agent adds

- **Context-aware:** selects relevant facts and guidance, identifies possible changes, conflicts and gaps, and checks source references.
- **Proactive planning:** proposes goals, context, communication directions, boundaries and expected outcomes. The broker can approve or request replanning in one sentence.
- **Business action:** separates feedback for each property and proposes old/new CRM values with evidence and uncertainty. It does not modify customer or viewing records.
- **Human-AI collaboration:** requires review before calling and recommends broker handoff with reasons and evidence afterward. It cannot promise a price, loan approval or appointment.

## Setup

Python 3.11+. Run from this app directory:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[test]"
```

Create a local `.env` using [.env.example](.env.example); preserve any existing configuration. The Web app requires a Doubao key and an enabled model:

```dotenv
DOUBAO_API_KEY=<your-key>
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_MODEL=<your-enabled-model>
ESTATE_ANALYSIS_MODE=doubao
ESTATE_ENABLE_LIVE=false
ESTATE_DOUBAO_ANALYSIS_AUTHORIZED=false
```

Start the UI:

```bash
.venv/bin/python -m streamlit run src/real_estate_buyer_followup/demo/streamlit_app.py --server.address 127.0.0.1 --server.port 8501 --browser.gatherUsageStats false
```

Open `http://127.0.0.1:8501`. **Mock simulates the phone call only. Web context selection, planning and analysis still use Doubao and may incur model charges.** Missing credentials and model failures produce errors rather than silently substituting recorded analysis.

## Walkthrough

1. **Preparation:** inspect the synthetic customer, communications, completed viewings and property facts; select knowledge files and enter a goal. Mock is selected by default.
2. **Agent Planning:** review the generated task. Approve it or provide a natural-language change request. Approval does not dial.
3. **Execution:** click a separate execution button. Mock returns a fixed fictional transcript. Live mode submits through the official CALL-E Python SDK and polls the same Call every three seconds while the page is open.
4. **Results:** review the task summary, nonempty CRM suggestions, follow-up recommendations and original transcript. A recording is playable only if the provider actually supplies a supported recording URL.

A fresh page starts at preparation. Execution records persist in SQLite; the current task can be revisited through the step navigation. Repeated analysis and refresh do not modify the fixed CRM snapshot.

### Synthetic scenario

Ms. Zhang wants a three-bedroom home in Pudong, Shanghai, with a CNY 5,000,000 ceiling:

- October 12: prefers a metro walk of about ten minutes or less.
- October 20: says living-room space also matters; no confirmed trade-off yet.
- October 30: views A, Pudong Garden (CNY 4.8m, 92 m², 18 m² living room, eight-minute metro walk), and B, Riverside Residence (CNY 5.3m, 108 m², 30 m² living room, eighteen-minute metro walk). Feedback is initially empty.
- Only during the Mock follow-up does she prioritize space and accept a longer metro walk while retaining her budget ceiling. No exact new commute limit is inferred.

Dates are fixed fixture dates, not relative to the day the demo runs. Alternative test cases are independent branches, not additional past events for this customer.

## Knowledge library

The preparation page selects local Markdown files without showing all their contents:

- [Viewing feedback guide](src/real_estate_buyer_followup/knowledge/viewing-feedback-guide.md): price objections, budget constraints and transport trade-offs.
- [Shanghai purchase FAQ](src/real_estate_buyer_followup/knowledge/shanghai-purchase-faq.md): static policy references with source URLs, dates and applicability restrictions.

Maintain entry IDs and metadata when editing. Doubao selects relevant paragraphs; the program validates references and freezes the selected snapshot for review. Documents are data, not instructions overriding the approved task. Replan and review after changing knowledge. This is paragraph selection over a small library, not vector search or live policy lookup. There is no PDF/TXT upload parser. Policy references were reviewed on 2026-11-02 and require renewed applicability checks before use; they do not determine personal eligibility or loan approval.

## Optional live calling

```bash
.venv/bin/python -m pip install -e ".[live]"
```

Set `CALLE_API_KEY` using a project key from the [CALL-E Dashboard](https://dashboard.heycall-e.com). MCP OAuth does not provide SDK credentials. Select Live in preparation, enter an authorized E.164 destination and a supported locale, review contact permission and approve the task, then explicitly execute the call.

**The Web Live selection enables the adapter independently of `ESTATE_ENABLE_LIVE`.** That environment flag and optional `ESTATE_LIVE_PHONE/LOCALE` defaults apply to programmatic use. No page render or status read submits a new call. Region, locale, account permissions and balance remain subject to provider support; a synthetic replay does not certify live language coverage.

The reviewed destination, task, schema and idempotency identity are saved with the execution. An ambiguous submission stops automatic dispatch; recovery retains the original request identity rather than creating a fresh call. Analysis retries only analysis. Completed calls with pending results keep being monitored; final unavailable results stop monitoring. Three consecutive read errors pause page polling, with an explicit same-call resume action.

Closing the page pauses polling but **does not hang up a submitted call**. Ctrl+C stops the local server, not the cloud call. This demo has no guaranteed provider cancellation, recurring scheduler or real-time transfer. Full transcripts normally become available after the call; polling is not real-time ASR. The result schema is compiled by this application, not invented by CALL-E. Inspect the [synthetic request examples](examples/README.md).

### Privacy and authorization

Real transcript/model analysis requires per-task consent or explicit project-owner authorization recorded in `ESTATE_DOUBAO_ANALYSIS_AUTHORIZED=true`. New deployments default to false and must not inherit another owner's consent.

All textual UI outputs use a shared presentation redactor, including transcript, evidence, summaries, nested JSON, CRM suggestions and surfaced errors. It hides recognizable numeric phone forms; it is not general personal-data anonymization and does not recognize every possible number spelled out in natural language. Dispatch inputs, stored source evidence and model analysis inputs remain unchanged. Only use authorized test data on a trusted local machine. Optional recording playback is private source audio and can itself contain spoken personal data; text redaction does not alter recordings.

SQLite retains plans, provider responses, transcripts and suggestions for recovery. `.env`, `var/`, database files, environments and logs are ignored. Never put private artifacts into source files, fixtures or knowledge documents. The app has no production authentication or multi-user permission system.

## Offline verification

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m real_estate_buyer_followup --db var/demo-preview.sqlite3 --case preferences
```

These paths require no credentials or outbound call. Tests replace model/provider boundaries. The CLI uses deterministic planning and recorded extraction, previews CRM suggestions and must not be presented as a live model benchmark. From the repository root also run:

```bash
python3 scripts/validate_repository.py
```

## Boundaries

No real CRM integration, property matching engine, recurring scheduling, CRM event automation, live search, in-call tools, transfer, negotiation or appointment booking is implemented. The internal transactional writeback prototype is exercised only by explicitly enabled storage tests; Web and default workflows are preview-only. Strict JSON Schema and evidence checks reduce unsupported updates but do not guarantee correct business judgments. No measured live A/B improvement is claimed.

See [architecture](docs/architecture.md) for module responsibilities, data flow and recovery boundaries. Historical process documents and Chinese originals are retained outside the contribution directory, rather than shipped as current product documentation.
