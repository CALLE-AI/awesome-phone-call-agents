# table-rescue

Cascade coordinator that recovers cancelled restaurant tables with CALL-E phone calls.
It confirms reservations before service, and when a guest cancels, it offers the freed
table to waitlist guests in priority order until someone accepts.

Dry-run is the default. Live calls require an explicit `--live` flag and always run
inside a call budget.

## How it works

1. Confirm phase: call each `PENDING_CONFIRM` reservation; the agent ends every call by
   stating an `OUTCOME:` token (CONFIRMED, CANCELLED, RESCHEDULED, NO_ANSWER).
2. Cascade phase: for each cancelled slot, call matching waitlist entries (consent,
   WAITING status, party size within tolerance, slot inside their window) in priority
   order until one ACCEPTED. The slot is marked RECOVERED.
3. Writeback: reservations and waitlist files are rewritten atomically, every decision
   is appended to the run audit log, and a masked staff report is written.

## Safety model

- Dry-run by default: outcomes come from `data/fixtures/dry_run_outcomes.jsonl`; no
  network access.
- Live calls need `--live` plus a `--max-calls` budget (default 10). The engine stops
  before dialing once the budget is exhausted.
- Consent: records with `consent: false` are never dialled (audited as
  SKIPPED_NO_CONSENT).
- Idempotency: reruns with the same `--run-id` skip already-dialled targets
  (SKIPPED_DUPLICATE).
- Cancel: `table-rescue cancel --run-id <id>` marks the run cancelled; later
  invocations with the same run id refuse to dial.
- Call window: live calls are refused outside `--call-window-start/end`
  (default 09:00-21:00 local).
- All sample phone numbers are fictional reserved numbers; reports mask numbers to the
  last two digits.

## Setup

Requires Python 3.10+. The CALL-E CLI is only needed for live calls.

```bash
cd apps/python/table-rescue
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on POSIX
pip install -e ".[dev]"
```

For live calls, install and log in to the CALL-E CLI (npm package `@call-e/cli`):

```bash
npm install -g @call-e/cli
calle auth login --base-url https://seleven-mcp-sg.airudder.com --channel openagent_oauth
```

## Usage

Dry-run (no calls):

```bash
cp data/reservations.sample.jsonl data/reservations.jsonl
cp data/waitlist.sample.jsonl data/waitlist.jsonl
table-rescue run --run-id smoke-1
```

Live (real calls through CALL-E MCP Streamable HTTP using the CALL-E CLI token cache):

```bash
table-rescue run --run-id live-1 --live --max-calls 6
```

Cancel a run:

```bash
table-rescue cancel --run-id live-1
```

## Side effects

- Live mode places real outbound phone calls through CALL-E and consumes call credit.
- Live mode reads the CALL-E CLI token cache (`~/.calle-mcp/cli`); the app never stores
  credentials.
- The app rewrites `data/reservations.jsonl` and `data/waitlist.jsonl` in place and
  writes `state/runs/<run-id>/audit.jsonl` plus `state/runs/<run-id>/report.md`.

## Credential handling

Access tokens are read from the CALL-E CLI token cache at call time, held in memory
only, and never written to app state or logs.

## Tests

```bash
python -m pytest
```

The default suite is a dry-run/fake path: no CALL-E credentials, no network, no real
calls. Live verification is opt-in: run one small `--live --max-calls 1` run against a
phone you control.

## Design rationale and evidence

- **The problem is measurable revenue loss.** Restaurant seats are perishable inventory:
  an empty table at 8pm is inventory gone forever. Cornell's restaurant revenue
  management research treats no-shows and overbooking as core levers of restaurant
  revenue ([Kimes et al., Cornell Center for Hospitality Research](https://ecommons.cornell.edu/bitstreams/56f1b36d-beb8-42fb-aeea-9fdb59be6c29/download)).
- **Proactive reminder calls work.** Systematic reviews consistently find reminder calls
  and messages reduce no-shows and improve attendance
  ([McLean et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4831598/);
  [Al-Turbag et al. 2026 meta-analysis](https://jhmhp.amegroups.org/article/view/10215/html)),
  and live conversational calls outperform one-way automated reminders in some settings
  ([Parikh et al. 2010, American Journal of Medicine](https://www.amjmed.com/article/S0002-9343(10)00108-7/fulltext)).
  A conversational agent that can actually accept "move it to 8pm" as an answer is the
  natural next step of that evidence.
- **Consent-first is a legal requirement, not a nicety.** The FCC's 2024 declaratory
  ruling holds that AI-generated voices in outbound calls fall under the TCPA's
  "artificial voice" provisions, which require prior express consent
  ([FCC 24-17](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal)).
  The consent flag, masked reports, and call-window guard implement this position.
- **Structured results need a protocol plus a fallback.** Structured-output techniques
  improve machine-readability of LLM responses but do not guarantee semantic validity;
  empirical studies document failure modes such as well-formed but wrong or missing
  fields ([arXiv empirical study](https://arxiv.org/html/2606.09395v1)). The OUTCOME
  token protocol, keyword fallback, and ERROR escalation are a pragmatic
  trust-but-verify design for the same problem on voice summaries.
- **Idempotency keys and budgets are proven reliability patterns.** Duplicate-call
  prevention mirrors idempotency-key practice in payment APIs, and the stop-before-dial
  call budget is a circuit-breaker against runaway automation.
- **Escalate ambiguity to humans.** No-answer and error targets get exactly one retry,
  then a staff escalation in the report - human-in-the-loop practice for consequential
  automated actions, in the spirit of disclosure-by-design popularized by early
  phone-calling agents ([Google Duplex disclosure debate, 2018](https://www.theverge.com/2018/5/10/17342414/google-duplex-ai-assistant-voice-calling-identify-itself-update)).

## Limitations

- Cascade runs only for reservations cancelled during the same run.
- One retry per no-answer target (`--no-answer-retries`).
