# mobilize

**Parallel human dispatch under a deadline, built on [CALL-E](https://www.heycall-e.com/).**

When you need three people in the next hour, calling them one at a time is
the bottleneck — and the only reason anyone ever did it that way is that
humans have one mouth. `mobilize` dispatches calls to a consented pool of
people **in parallel waves**, scores how firm each "yes" actually is, and
stops calling the moment enough people have confirmed.

Built for **CALL-E: Your Code Is Calling**, targeting **Most Practical Use
Case**: this replaces a manual process a real coordinator runs today, and
the improvement is measured, not asserted.

```
python -m mobilize.app.cli --pool-size 150 --need-count 3 --seed 7
```

```
Generating a simulated donor pool of 150 (seed=7)...
Need: 3 confirmed donors, budget 40 calls, deadline 60 min.

── wave 0: dialing 6 candidates in parallel
  donor_0111   firm_yes     commitment=0.90
  donor_0006   firm_yes     commitment=0.91
  donor_0146   soft_yes     commitment=0.48
  donor_0081   no_answer    commitment=0.00
  donor_0012   firm_yes     commitment=0.92

✓ need met — 3 confirmed at 0.3s. No further wave will be dispatched.
  donor_0057   no           commitment=0.00

Filled: True   Confirmed: 3/3   Calls used: 6   Waves: 1
Over-recruitment ratio: 2.00x
```

---

## The problem

A hospital needs three O-negative donors within the hour. A coordinator
phones down a registry, one number at a time. Most don't pick up. Many are
ineligible. Many say yes and never arrive. This is a real, current process:

- O-negative is the universal donor type but present in only ~8% of the
  (white/Caucasian) population and rarer still in other groups, which is
  exactly why supply runs short under pressure — [Blood banks face O-neg
  shortages](https://medicalxpress.com/news/2026-03-blood-banks-neg-shortages-donations.html).
- Manual, sequential call trees are structurally slow: industry guidance
  puts an all-hands manual call tree at **up to three and a half hours**
  to fully propagate, and even a comparatively fast tree sees roughly a
  third of recipients not reached on the first attempt —
  [Automated Phone Tree Systems](https://www.alertmedia.com/blog/phone-tree/).
- Re-donation and recruitment studies (e.g. the Guangzhou Blood Center
  O-negative/A-negative shortage response) confirm that recruitment
  outcomes vary significantly by *how* previous donors are contacted and
  asked — [PMC: Maintaining adequate donations](https://pmc.ncbi.nlm.nih.gov/articles/PMC7753343/).

None of these sources measure the specific stated-yes/actual-showup gap
this project models — that gap is estimated from the simulator's calibrated
population and validated against real CALL-E calls (see
[Evaluation](#evaluation) below), not claimed as an established literature
number. The sequential-call bottleneck and O-negative scarcity, however, are
independently documented, which is why this domain was chosen.

## Why a phone call, why an agent

- **Why a phone call:** the people who need to respond may not check
  messages for an hour. A ringing phone is close to the only channel with
  sub-minute expected response time.
- **Why an agent:** three simultaneous confirmations from a dozen-plus
  parallel conversations is not something a human coordinator can do at any
  staffing level. This is not automating an existing task — it's a
  capability that didn't exist before software could hold multiple phone
  conversations at once.
- **Why every callee is consented:** the pool is a donor registry. People
  join it specifically to be called when their blood type is urgently
  needed. `mobilize` is deliberately not built for cold outreach — see
  [skills/mobilize/references/safety.md](skills/mobilize/references/safety.md).

## The technical core

### 1. Adaptive wave dispatch, not "cancel in-flight calls"

CALL-E's API has **no operation to cancel an in-flight call** — confirmed by
reading the [OpenAPI spec](https://docs.heycall-e.com/openapi/calle.openapi.yaml)
directly: `POST /v1/calls`, `GET /v1/calls/{id}`, `GET /v1/calls/{id}/events`
is the entire surface. `canceled` exists only as a terminal status CALL-E
itself can set. So `mobilize` dispatches in **waves**: size the first wave
from calibrated priors, wait for results, and only dispatch a further wave
if the need is still unmet. The instant the need is met, **no further wave
is ever dispatched** — this is honest, and it's still the load-bearing
mechanism of the whole project. See `mobilize/core/planner.py` and
`mobilize/core/dispatcher.py`.

**Dispatch within a wave is actually concurrent**, via `asyncio.gather`, not
a `for` loop awaiting each call in turn — a sequential loop would silently
serialize the exact thing this project claims to do.
`mobilize/tests/test_dispatch_parallelism.py` proves this directly: against
a transport with artificial per-dispatch latency, dispatching 8 candidates
takes roughly one delay window, not eight.

### 2. Commitment calibration — a stated yes is not a confirmation

People say yes to be agreeable and don't follow through. `mobilize/core/commitment.py`
scores the call's evidence text for firm language ("leaving now", "on my
way") versus hedged language ("I'll try", "maybe"), blended with the
candidate's historical show-up rate, into a calibrated 0–1 commitment score.
Only responses above threshold count as confirmed. See
[skills/mobilize/references/commitment-model.md](skills/mobilize/references/commitment-model.md).

### 3. Over-recruitment as constrained optimization

Given candidates with priors on accept/show-up probability, choose the
smallest wave whose *expected* confirmations clear the need with a safety
margin — greedy-by-prior-score, which is the correct policy for maximizing
expected count under a cardinality constraint over independent trials. See
`mobilize/core/planner.py::plan_wave`.

### 4. Durability — idempotency-keyed dispatch plus crash recovery that actually polls

Each dispatch is written to the ledger *after* the provider accepts the
call (a `call_id` doesn't exist before that), so durability doesn't come
from write-ordering alone — it comes from a precomputed, ledger-derived key
(`(mobilization_id, candidate_id)`) passed straight through as CALL-E's own
`Idempotency-Key` request header. If the process crashes between the
provider accepting the call and the ledger write completing, a retry on
restart resends the identical key and CALL-E returns the original call
instead of placing a second one. See `mobilize/core/ledger.py` and
`mobilize/transports/calle.py`.

On restart, recovered in-flight candidates are never re-dispatched *and*
are actively polled for their outcome (bounded by `recovery_timeout_s`) —
against the real transport this recovers genuine results, since call state
lives server-side and survives a process restart. Prior confirmations
already recorded in the ledger are reconstructed from the ledger itself at
startup, using each entry's own timestamp — a resumed run neither forgets
what was already confirmed (and over-dispatches past the need) nor reports
a `time_to_fill` measured only from the moment it happened to restart.

For real calls specifically, `mobilization_id` is **derived deterministically
from the request itself** (`need_label` + phone numbers), not a timestamp or
random UUID — a retry after a crash reuses the same idempotency keys instead
of silently starting an indistinguishable parallel run. See
`mobilize/core/ids.py`.

**This is proven, not asserted:** `mobilize/tests/test_crash_safety.py`
`SIGKILL`s a real subprocess mid-dispatch and restarts it against the same
ledger file — the same methodology used to crash-test a from-scratch LSM-tree
key-value store in an earlier project. `mobilize/tests/test_recovery_polling.py`
and `mobilize/tests/test_resume_reconstruction.py` separately prove a
recovered in-flight call is polled and counted, and that a resumed run with
already-confirmed results neither forgets nor re-dispatches them. 52 tests
pass, including all three.

### 5. Governance — consent is enforced in code, not just policy

`mobilize/core/policy.py` enforces do-not-call, cooldowns, contact-fatigue
limits, and calling-hour windows *before* a candidate is ever handed to a
transport. **Both real-call entry points (CLI `--real` and the MCP
`mobilize_real` tool) run under governance by default** — it is not
something a caller has to remember to opt into.

Governance state is **persisted to disk and reloaded on every real-call
invocation**, not reconstructed fresh each time — a fresh in-memory state
per call would make cooldown and contact-fatigue tracking silently useless
across separate CLI runs or MCP tool calls, since nothing would ever
remember a prior call happened. Calling-hour windows are checked against
**each candidate's own local timezone** (`Candidate.timezone`), not the
server's — a naive UTC-only comparison could call someone at 3am their
time while judging it a reasonable hour on the machine running the code.
See [skills/mobilize/references/safety.md](skills/mobilize/references/safety.md)
and `mobilize/tests/test_governance_persistence.py`.

### 6. Result binding — never trust a response you can't verify

Before a CALL-E result counts toward a confirmation, `mobilize` checks that
the returned `metadata.candidate_id` and phone number actually match the
candidate the call was dispatched to. A mismatch is treated as a failed
result, not silently trusted — see `mobilize/transports/calle.py::_to_call_result`
and `mobilize/tests/test_transport_validation.py`.

## Evaluation

The account ships with 20 free CALL-E calls — not enough to validate a
dispatch policy. So the policy is validated for free, at scale, against a
synthetic population with **known ground truth**
(`mobilize/sim/population.py`): each simulated donor has a hidden true
show-up probability the system never sees directly, only noisy signals
(pickup, stated answer, hedging language) — exactly what the real transport
would produce.

**Measured result, 300 trials** (`python -m mobilize.sim.harness`):

| Policy | Fill rate | Confirmation accuracy | Mean calls used | Over-recruitment |
|---|---|---|---|---|
| **Calibrated (this project)** | 99.7% | **94.6%** | 11.0 | 3.7× |
| Stated-yes-only (naive) | 100% | 87.7% | 6.8 | 2.3× |
| Call-everyone | 100% | 80.2% | 40.0 | 13.3× |

`confirmation_accuracy` is the metric that matters: of the donors a policy
believed were confirmed, what fraction would *actually* show up? Fill rate
alone is a misleading headline — the naive policy fills just as reliably,
it just fills with people who don't come. The calibrated policy trades
~60% more calls for a 7-point accuracy gain over naive, and closes most of
the gap to a much more expensive call-everyone baseline at roughly a
quarter of the calls.

These numbers are **directly reproducible** — run `python -m mobilize.sim.harness`
yourself. They are not claims about real human behavior beyond what the
reality-validation step below confirms.

### Reality validation

Real CALL-E calls (see [Setup](#setup)) are checked against the simulator's
predicted commitment scores as part of the demo. Real transcripts and
results are committed under `mobilize/artifacts/` so this claim doesn't have
to be taken on faith.

Two real calls placed on day one (`mobilize/artifacts/smoketest_1_result.json`,
`smoketest_2_result.json`):

- **Call 1** validated the full transport path — dispatch, poll, transcript
  retrieval, AI disclosure, structured-result extraction — end to end
  against a real conversation. Firm language ("15 minutes") scored 0.71,
  correctly classified `firm_yes`.
- **Call 2** ran the exact production `mobilize()` pipeline (dispatcher +
  ledger + real transport, not just the transport in isolation) with the
  donor-mobilization task prompt. The response scored **0.54 — just below
  the 0.55 confirmation threshold** — and `mobilize()` correctly reported
  `filled: False`, refusing to count a borderline hedge as confirmed. This
  is the calibration threshold behaving as designed at a genuine decision
  boundary on a real call, not a synthetic one.

Both calls stayed within the ~30–45 second range the task prompt targets.

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export CALLE_API_KEY=your_key_here   # from dashboard.heycall-e.com/account/api-keys
```

Run the free simulated demo (no calls placed, no cost):

```bash
python -m mobilize.app.cli --pool-size 150 --need-count 3 --seed 7
```

Run the test suite:

```bash
pytest mobilize/tests/ -v
```

Run the evaluation harness (zero cost, ~5 min for 300 trials):

```bash
python -m mobilize.sim.harness
```

### Placing real calls (spends CALL-E credits)

```bash
python -m mobilize.app.cli --real --phones +1XXXXXXXXXX --need-label "your test message"
```

This calls **only** the exact numbers you pass — never a larger pool — and
requires an explicit `yes` confirmation before dispatching. Every number is
validated as E.164 before anything is sent; malformed input is rejected
with no network call made. Real calls run under governance by default
(do-not-call, cooldowns, contact fatigue, calling-hour windows) and
`CalleTransport` refuses to send its bearer token to any host outside
CALL-E's own API — both closed off, not just documented, after external
review (see `mobilize/transports/base.py::validate_trusted_base_url`).
Use a number you own or are authorized to call.

### MCP server

```bash
python -m mobilize.mcp.server
```

Exposes `mobilize_simulated` (free) and `mobilize_real` (spends credits,
never expands beyond the phones explicitly given) as MCP tools, so any
MCP-compatible agent can trigger a mobilization directly. `mobilize_real`
requires `confirm=true` explicitly — called without it, it returns a
preview of exactly what would be dialed and places no calls. An MCP tool
has no interactive prompt, so this two-call pattern is the equivalent of
the CLI's typed `yes` confirmation.

### Live dashboard

```bash
python -m mobilize.app.dashboard
open http://localhost:8731
```

Watch a simulated mobilization unfold in real time over a WebSocket: each
candidate lights up on dispatch, colors by outcome as results stream in,
and the map shows exactly how many donors in the pool were never called
once the need was met. Free, simulated, no calls placed — this is the demo
visualization, not a production service. Port is configurable via
`MOBILIZE_DASHBOARD_PORT`.

## Repository layout

```
mobilize/
├── core/          # types, ledger, commitment scoring, planner, dispatcher, governance
├── transports/     # base protocol, real CALL-E transport, simulated transport
├── sim/            # synthetic population + evaluation harness
├── mcp/            # MCP server
├── app/            # CLI demo runner
├── artifacts/       # committed real-call transcripts and results
└── tests/          # 52 tests incl. property-based, real-subprocess crash, and
                    #   concurrency/validation/resume tests added after
                    #   two rounds of external review
skills/mobilize/    # Agent Skill (SKILL.md) wrapping mobilize() for reuse
```

## Generalizes to

The same engine, unchanged, applies to emergency shift coverage, volunteer
disaster mobilization, and on-call incident escalation — any "get N people
from a consented pool by a deadline" problem. The blood-donor domain was
chosen because it is unambiguously real, honestly demonstrable without
contacting anyone who hasn't consented, and gives the clearest possible
stakes for why stopping at exactly the right moment matters.

## What was cut, and why

Time-boxed for a 40-day solo build. Cut in this order if time runs short,
documented here rather than silently dropped: a Prometheus metrics exporter
→ the planner's optimizer simplifies to fixed-wave-size heuristics →
contact-fatigue modeling. The live WebSocket dashboard and the terminal CLI
are both delivered — either can be dropped without touching the engine's
core guarantees (wave dispatch, commitment calibration, crash-safe ledger,
governance), which are never cut.
