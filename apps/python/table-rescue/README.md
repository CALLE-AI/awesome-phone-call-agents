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
   is appended to the run audit log, and a masked staff report is written, optionally
   with a protected-revenue estimate (`--avg-check-per-guest`).

## Safety model

Every guard lives in `table_rescue/safety.py` and is enforced by code, not
configuration.

| Threat | Control | Reviewer item |
| --- | --- | --- |
| Misdirected live dials | Region-aware E.164 validation at load time; per-region calling code and national length checks; reserved fictional NANP numbers (555 block) can never be dialed live | 1 |
| Unauthorized destinations | Operator-curated `data/authorized_destinations.jsonl` allowlist keyed on the exact E.164 string; a printed manifest requires typed confirmation before the first call; every dial re-checks authorization | 1 |
| Credential exfiltration | The MCP origin is pinned to `https://seleven-mcp-sg.airudder.com`; `--base-url` values outside the allowlist (including any `http://` origin) are rejected before any network call, including `calle auth` | 2 |
| Double-booking after an uncertain call | Outcomes are classified from the explicit `OUTCOME:` token only, per leg family; prose keywords are informational hints; NO_ANSWER/UNCERTAIN/ERROR mark the target NEEDS_REVIEW and stop the run (exit code 2) before anyone else is called | 3 |
| Run continuation | `table-rescue resume --run-id <id>` retries only NEEDS_REVIEW/pending targets after human review; settled targets are never re-dialed; operator-cancelled runs refuse resume | 3 |

Exit codes: `0` success, `2` reconciliation required, `3` budget exhausted,
`1` other errors. `table-rescue preflight` validates every live prerequisite
without placing calls (`--json` for CI).

### Verification matrix

| Reviewer concern | Proof |
| --- | --- |
| "models accept arbitrary strings" | `tests/test_models.py::test_reservation_from_line_rejects_non_e164_phone` |
| "bundled non-reserved sample numbers can reach the live path" | `tests/test_safety.py::TestFictionalBlock`, `tests/test_cli.py::test_run_live_fictional_number_never_reaches_dial` |
| "region-aware E.164 validation" | `tests/test_safety.py::TestRegionRules` |
| "exact operator authorization" | `tests/test_safety.py::TestRunSafety`, `tests/test_cli.py::test_run_live_aborts_on_missing_authorization` |
| "no credential to arbitrary/insecure origin" | `tests/test_calle_client.py::test_mcp_client_rejects_foreign_origin`, `tests/test_safety.py::TestOrigin` |
| "no-answer and ambiguous outcomes must stop" | `tests/test_engine.py::test_waitlist_no_answer_never_advances_to_next_recipient`, `e2e/test_full_run.py::test_uncertain_outcome_stops_run_and_never_conflicts` |
| "no conflicting offer after an uncertain call" | `tests/test_calle_client.py::test_map_terminal_status_token_only_decisions`, `tests/test_calle_client.py::test_prose_without_token_is_never_decisive` |

Dry-run by default: outcomes come from `data/fixtures/dry_run_outcomes.jsonl`; no
network access. Other standing guards: live calls need `--live` plus a `--max-calls`
budget (default 10) and stay inside `--call-window-start/end` (default 09:00-21:00
local); records with `consent: false` are never dialled (SKIPPED_NO_CONSENT); every
call goal instructs the agent to identify itself as an automated assistant; reruns
with the same `--run-id` skip already-dialled targets (SKIPPED_DUPLICATE);
`table-rescue cancel --run-id <id>` marks a run cancelled and later invocations
refuse to dial; reports, live manifests, and error messages mask phone numbers to
the last two digits, and provider summaries/errors are sanitized before any
print or persistence.

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

Live runs also need a region and an operator-curated allowlist: put every real
destination phone (exact E.164 string) in `data/authorized_destinations.jsonl`
(copy `data/authorized_destinations.sample.jsonl` for the format), then run
`table-rescue preflight` to validate everything before dialing.

## Usage

Dry-run (no calls):

```bash
cp data/reservations.sample.jsonl data/reservations.jsonl
cp data/waitlist.sample.jsonl data/waitlist.jsonl
table-rescue run --run-id smoke-1 --avg-check-per-guest 25
```

Live (real calls through CALL-E MCP Streamable HTTP using the CALL-E CLI token
cache; requires `--region` and every destination present in
`data/authorized_destinations.jsonl` - see Setup and the Safety model):

```bash
table-rescue run --run-id live-1 --live --region VN --max-calls 6
```

Validate every live prerequisite without placing any call:

```bash
table-rescue preflight --data-dir data --region VN
```

Machine-readable (CI):

```bash
table-rescue preflight --data-dir data --region VN --json
```

After a run stops with NEEDS REVIEW (exit code 2), review the report, then:

```bash
table-rescue resume --run-id run-20260910-190000 --data-dir data
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

## Where the data comes from

The JSONL files are the integration boundary, not a product UI: restaurants keep their
waitlist and reservations wherever they live today - a booking platform (OpenTable,
Resy), the POS, or a shared sheet - and any export or API poll that maps those records
into the documented schema (see the skill's `io-schemas.md`) feeds the cascade. The
consent flag is captured by staff when a guest joins the waitlist; guests without
consent are skipped and audited. Native connectors (booking-platform writebacks,
n8n/Dify plugins) are the natural next step.

## Credential handling

Access tokens are read from the CALL-E CLI token cache at call time, held in memory
only, and never written to app state or logs. Tokens are sent only to the pinned
official MCP origin (`https://seleven-mcp-sg.airudder.com`); any other `--base-url`
is rejected before any network call.

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
  revenue ([Kimes 2004, Cornell Center for Hospitality Research](https://ecommons.cornell.edu/entities/publication/779ca191-03a2-4abe-8e4b-2de7fdd4f7ff)).
- **Proactive reminder calls work.** Systematic reviews consistently find reminders
  improve attendance across modalities
  ([Gurol-Urganci et al. 2013, Cochrane review](https://pubmed.ncbi.nlm.nih.gov/24310741/);
  [McLean et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4831598/)). Simple
  one-way reminders are the floor, not the ceiling: McLean et al. find "reminder plus"
  designs that enable a response outperform bare reminders, and in one outpatient study
  live conversational reminders beat automated ones
  ([Parikh et al. 2010, American Journal of Medicine](https://pubmed.ncbi.nlm.nih.gov/20569761/)).
  A conversational agent that can actually accept "move it to 8pm" as an answer is the
  natural next step of that evidence.
- **Consent-first is a legal requirement, not a nicety.** The FCC's 2024 declaratory
  ruling holds that AI-generated voices in outbound calls fall under the TCPA's
  "artificial voice" provisions, which require prior express consent
  ([FCC 24-17](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal)).
  The consent flag, masked reports, and call-window guard implement this position.
- **Structured results need a protocol, not prose.** Structured-output techniques
  improve machine-readability of LLM responses but do not guarantee semantic validity;
  empirical studies document failure modes such as well-formed but wrong or missing
  fields ([Song et al. 2026, arXiv:2606.09395](https://arxiv.org/abs/2606.09395)). Outcomes are
  classified from the explicit `OUTCOME:` token only: a prose-only summary stops the
  run for review (UNCERTAIN), and keyword hints from the transcript appear in the
  report for the human reviewer. This is a pragmatic trust-but-verify design for the
  same problem on voice summaries.
- **Idempotency keys and budgets are proven reliability patterns.** Duplicate-call
  prevention mirrors idempotency-key practice in payment APIs, and the stop-before-dial
  call budget is a circuit-breaker against runaway automation.
- **Escalate ambiguity to humans.** The first no-answer or error target stops the
  run (exit code 2) with the target marked NEEDS_REVIEW for a staff escalation in
  the report; the same recipient is never redialed automatically - human-in-the-loop
  practice for consequential automated actions, in the spirit of
  disclosure-by-design that the first
  consumer phone-calling agent adopted after public debate ([Google Duplex, 2018](https://research.google/blog/google-duplex-an-ai-system-for-accomplishing-real-world-tasks-over-the-phone/)).

## Limitations

- Cascade runs only for reservations cancelled during the same run.
- The first no-answer marks the target NEEDS_REVIEW and stops the run with exit
  code 2 and a Needs review report section - uncertain outcomes never advance the
  cascade and the same recipient is never auto-redialed; continue only via
  `table-rescue resume` after review.

## References

1. Kimes, S. E. (2004). _Restaurant Revenue Management_. Cornell Center for Hospitality
   Research Reports 4(2).
   https://ecommons.cornell.edu/entities/publication/779ca191-03a2-4abe-8e4b-2de7fdd4f7ff
2. Gurol-Urganci, I., de Jongh, T., Vodopivec-Jamsek, V., Atun, R., & Car, J. (2013).
   _Mobile phone messaging reminders for attendance at healthcare appointments._
   Cochrane Database of Systematic Reviews, CD007458.
   https://pubmed.ncbi.nlm.nih.gov/24310741/
3. McLean, S., Booth, A., Gee, M., Salway, S., Cobb, M., Bhanbhro, S., & Nancarrow, S.
   (2016). _Appointment reminder systems are effective but not optimal._ Patient
   Preference and Adherence. https://pmc.ncbi.nlm.nih.gov/articles/PMC4831598/
4. Parikh, A., Gupta, K., Wilson, A. C., Fields, K., Cosgrove, N. M., & Kostis, J. B.
   (2010). _The effectiveness of outpatient appointment reminder systems in reducing
   no-show rates._ American Journal of Medicine 123(6), 542-548.
   https://pubmed.ncbi.nlm.nih.gov/20569761/
5. Federal Communications Commission (2024). _Declaratory Ruling FCC 24-17: AI-generated
   voices in robocalls are "artificial" under the TCPA._
   https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf
6. Song, Y., Rajput, P., Sun, T., Ezzini, S., Bissyande, T. F., & Klein, J. (2026).
   _Empirical Study for Structured Output Control in LLMs for Software Engineering._
   arXiv:2606.09395. https://arxiv.org/abs/2606.09395
7. Google Research (2018). _Google Duplex: An AI System for Accomplishing Real-World
   Tasks Over the Phone._
   https://research.google/blog/google-duplex-an-ai-system-for-accomplishing-real-world-tasks-over-the-phone/
