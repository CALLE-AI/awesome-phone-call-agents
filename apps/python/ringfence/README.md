# ringfence

**Independent fraud-verification calls for flagged transactions — never a
number the flagged request itself supplied.**

Scammers now use AI voice-cloning to impersonate a panicked grandchild or a
company executive and pressure a wire transfer through before anyone can
think twice. `ringfence` fights back with the same weapon: when a bank or
company's existing fraud-scoring system flags a transaction as risky,
`ringfence` places its own AI verification call — to the account holder's
number **already on file**, never a number that arrived with the flagged
request — before the money moves. Every result is an **advisory
recommendation for a human reviewer**, never an automatic action on the
money: ambiguous, unreachable, or red-flagged always recommends a hold or
an escalation, never guessed as fine.

**Host / provider:** CALL-E only, via the `calle-ai` Python SDK
(`POST /v1/calls`, `GET /v1/calls/{id}`, `GET /v1/calls/{id}/events`). No
other telephony provider is supported.

---

## Why this, why now

Americans 60+ reported **$7.748 billion** lost to online scams in 2025, up
**59%** from $4.885B in 2024 (FBI/IC3, via AARP's reporting on the 2025
FBI/FTC data). The FTC's own December 2025 report to Congress estimates real
losses may be as high as **$81.5 billion**, since fewer than 1 in 20 victims
ever report.
([AARP: FBI Report — Internet Crime Losses Hit $20.9 Billion](https://www.aarp.org/money/scams-fraud/fbi-ftc-report-2025-losses/))

Grandparent/family-emergency scams specifically: **$5M+** reported losses in
2025, with AI voice-cloning explicitly named as a growing driver — criminals
mimic the sound of a loved one in distress.
([FBI: Elder Fraud, in Focus](https://www.fbi.gov/news/stories/elder-fraud-in-focus))

These numbers describe real, ongoing losses, not a hypothetical threat model
— see [`references/scam-red-flags.md`](references/scam-red-flags.md) for how
each of `ringfence`'s verification questions maps to a specific,
consumer-protection-documented pressure tactic rather than an invented
taxonomy.

## Who triggers it

Not the individual watching their own phone — CALL-E cannot intercept or
monitor a personal incoming call (no OS/carrier-level call-screening
integration, and it would collide with two-party-consent recording law in
many jurisdictions). `ringfence` is a **B2B fraud-ops tool**: a bank, payment
processor, or company finance team's *own* existing fraud-scoring system
(which already flags unusual transactions today, by whatever rules or ML
they already run — `ringfence` does not build that part) calls
`ringfence`'s webhook/API/MCP surface with a **case**. `ringfence`'s job
starts there. The account holder never installs anything; they just receive
a smarter verification call than the generic "press 1 to confirm" robocall
a bank might already run.

---

## The one security invariant everything else depends on

**`ringfence` never calls a phone number that arrived as part of the flagged
request.** It only ever calls the number on file for the account, sourced
independently by the institution's own system before the case is submitted.
A case payload that tries to smuggle in an alternate "callback number" is
rejected outright for dialing purposes and logged as a security event —
never used, even if it happens to match the on-file number.

This is enforced in exactly one place —
[`ringfence/verify_call.py`](ringfence/verify_call.py)'s
`resolve_dial_target()`, which every surface (CLI, webhook, MCP) calls
through rather than re-implementing — and proven by a dedicated test:

```bash
python -m pytest tests/test_invariant_never_calls_request_supplied_number.py -v
```

`fixtures/12_number_substitution_attack.json` and
`tests/test_number_substitution_fixture.py` additionally prove this holds
for a concrete, fixture-shaped case, not just synthetic unit-test data.

---

## What the verification call asks

Disclosure-first: the call states immediately that it is an automated
verification call from the institution — never "is this really you," which
a coached or panicked victim will answer "yes" to mid-scam. It then asks
open, non-leading questions and listens for documented scam red flags:

| Signal asked about | Why (documented red flag) |
|---|---|
| "Did anyone ask you to keep this transaction private, or not to tell your bank or family?" | Secrecy/isolation demand is one of the most consistent scam markers — legitimate transactions are never secret. |
| "Is there time pressure — were you told this has to happen today or right now?" | Manufactured urgency is a core scam pressure tactic. |
| "Can you describe your relationship to the recipient, in your own words?" | Catches a mismatch between the caller's actual knowledge and the scammer's fabricated story — asked *before* any detail is repeated back to them, never after. |
| "Were you asked to pay by wire, gift card, or cryptocurrency specifically?" | Scammers prefer irreversible payment rails; legitimate large transactions rarely insist on one specific irreversible method. |
| Explicit "stop/hold everything" from the account holder, at any point | Immediately blocks — it must be easy to stop a transaction and hard to force one through, never the reverse. |

See [`references/scam-red-flags.md`](references/scam-red-flags.md) for the
citation behind each question. The structured result schema
(`ringfence/verify_call.py`'s `RESULT_SCHEMA`) captures each signal as its
own boolean field.

---

## Decision engine

`ringfence/decide.py` combines two things, neither trusted alone:

1. **Outcome-truth classification of the raw call** (adapted from
   [`apps/python/calltruth`](../calltruth/)'s `resolve.py`) — was this a
   real, completed conversation, or an ambiguous/unresolved one? CALL-E's
   own docs say the Calls API "does not guarantee a distinct no-answer or
   callee-decline value" and that `failure_code` has "no published enum" —
   `resolve.classify()` never trusts it directly.
2. The structured red-flag fields from the verification call.

Fails closed at every branch — a missing or unknown signal is never read as
"clean":

| Condition | Recommendation |
|---|---|
| Any red flag present (secrecy, urgency, unexplained relationship, irreversible-payment insistence) | `ADVISE_BLOCK` |
| Explicit hold/stop requested by account holder | `ADVISE_BLOCK` |
| Call resolution is `unresolved_ambiguous`, `no_answer_confirmed`, or `rejected_before_ring` | `ESCALATE_TO_HUMAN` — never `ADVISE_ALLOW` on an unanswered or ambiguous call |
| Clean conversation, no red flags, explicit confirmation | `ADVISE_ALLOW` |
| Anything not covered above (including `policy_or_content_refusal`, `malformed_or_unsupported_destination`, `answered_declined`) | `ESCALATE_TO_HUMAN` (the default fallback) |

### Advisory only — a human decides

Every value above is a **recommendation**, not an action, and is named so
deliberately. It comes from a heuristic chain — speech recognition, then a
language model's reading of what was said, then the red-flag table in
[`references/scam-red-flags.md`](references/scam-red-flags.md) — applied to
a single phone conversation. That chain is not reliable enough to move or
hold someone's money by itself, so nothing in `ringfence` is wired to do
that:

- `ADVISE_ALLOW` means "this call surfaced no red flags," never "release
  the funds";
- `ADVISE_BLOCK` means "this call surfaced red flags worth a human
  looking at," never "freeze the account";
- `ESCALATE_TO_HUMAN` means the call established too little to recommend
  either way.

Every `Disposition` carries `advisory: true` and
`requires_human_review: true`, serialized into every API response, stored
record, audit report, and both demo pages (`tests/test_decide.py`,
`tests/test_webhook.py`, `tests/test_demo_server.py`). **Integrators must
not wire these values into an automated approve/hold action**: the
consequential decision belongs to a person inside the institution, with
this evidence trail in front of them.

**Scope boundary**: `ringfence` returns a recommendation to the
institution's own transaction system. It never moves money itself and never
makes a final legal/compliance determination — the institution's own system,
and a human in it, retains final authority.

---

## Measured evaluation

The 21-fixture corpus in [`fixtures/`](fixtures/) covers clean-legitimate
transactions (6, several distinct scenarios — tuition, a car down payment, a
medical bill, a real-estate deposit, a contractor payment, a family gift),
scam patterns (9 — every red flag isolated, several multi-flag combinations
including an elder-fraud framing, a business/CEO-fraud framing, and a
romance-scam framing), an explicit hold request, never-dialed/no-answer/
declined/connection-failed escalation cases (5), and the
number-substitution-attack case (1).

One escalation fixture (`21_connection_failed_during_attempt.json`) locks
in the provider-failure shape that exposed a real classifier bug: an
attempt with `started_at == completed_at` (zero ring time) carrying its own
`failure_code`, which `resolve.classify()` used to mislabel
`no_answer_confirmed` instead of a genuine connection failure. Fixed with a
new `connection_failed_during_attempt` outcome (`tests/test_resolve.py`),
with this fixture as the regression test.

Reproduce it yourself — nothing below is hand-typed:

```bash
python -m pytest tests/test_evaluation.py -v
```

As of this fixture corpus: **9/9 (100%)** scam-pattern fixtures correctly
recommend `ADVISE_BLOCK`/`ESCALATE_TO_HUMAN`, never `ADVISE_ALLOW`, and
**6/6 (100%)** clean-legitimate fixtures correctly recommend `ADVISE_ALLOW`
rather than being over-triggered into a false flag — both sides are
reported honestly, because a tool that flags everything is useless. (These
15 categorized fixtures are the scored ones; the remaining 6 cover
escalation and attack shapes asserted individually in `tests/`.)

This is **not** a claim about real-world scam-catch rates, and it measures
recommendation quality, not decisions this tool is permitted to make on its
own. It is a small, fixed, illustrative fixture corpus written for this
project, not a random sample of real calls — see each fixture's
`_evidence_source` for exactly what documented pattern it is modeled on.

### Exhaustive signal-space coverage

The 21 curated fixtures above are hand-written and narrative — each models
one specific, named scam or clean pattern. On top of them,
[`ringfence/synthetic_corpus.py`](ringfence/synthetic_corpus.py) generates a
**98-case corpus in memory** (not committed as JSON — reproducible, not
padding) that exhaustively enumerates the actual decision-relevant state
space `decide()` branches on, rather than sampling it:

- all **32 combinations** (2⁵) of the five boolean verification-call
  signals, crossed with both outcomes where a real conversation
  occurred (`answered_success`, `answered_declined`) — 64 cases,
- one case per documented ambiguity marker in `resolve.py`'s policy-refusal
  and malformed-destination marker lists — 20 cases, so every individual
  marker string is proven to resolve correctly, not just the few a
  hand-picked fixture happened to use,
- 9 no-conversation variants (no-answer, rejected-before-ring, and three
  distinct raw-`status` shapes of `unresolved_ambiguous`),
- 2 **naive-trap** cases where the call-level `status`/`task_completed`
  fields claim success while the attempt trail disagrees (the exact
  ambiguity CALL-E's own `errors.mdx` warns integrations not to trust) —
  with explicitly *clean* signals, so a naive implementation would
  recommend `ADVISE_ALLOW`,
- 3 **connection-failed-during-attempt** cases (zero ring time and/or an
  attempt-level `failure_code`) — the outcome category added after
  validation against the live API exposed that this was previously
  conflated with a confirmed no-answer; see the fixture note above.

Each case's expected recommendation is computed by an **independent
re-implementation** of the decision table (`oracle_disposition()`), written
separately from `decide.py`, not by calling `decide()` itself — so agreement
between the two is a real second opinion, not the module grading its own
homework.

Reproduce the full report (curated + synthetic + naive-vs-resolve
comparison), nothing below is hand-typed:

```bash
python -m ringfence.evaluation
python -m pytest tests/test_synthetic_corpus.py -v
```

**As of this corpus**: `decide()` agrees with the independent oracle on
**98/98 (100%)** synthetic cases. Comparing CALL-E's raw
`status`/`failure_code` (`naive_classify()` — what most integrations do
today, per CALL-E's own documented warning) against `resolve.classify()`'s
cross-referenced outcome across the same 98 cases: **28/98** outcome labels
disagree, and **2 of those** are *unsafe* disagreements — cases where
trusting the raw call-level flags directly would recommend `ADVISE_ALLOW`
for a transaction that never actually completed a real conversation, while
`resolve.classify()` correctly forces `ESCALATE_TO_HUMAN`. Combined with
the 15 scored curated fixtures, **113 cases** are evaluated in total.

---

## Validation against the live API

RingFence was not built against fixtures alone: before submission its live
path was exercised end to end against the real CALL-E API, on numbers the
author controls and with the recipient's consent. Those runs are not
included in this repository — no call outputs, transcripts, identifiers, or
timings are committed here, because a verification call's contents are
exactly the kind of material that should not live in a public repo. What
they produced, and what remains here, is the code:

**Four real bugs came out of exercising the live API, not out of code
review**, each fixed with a regression test:

1. **A connection failure read as a confirmed no-answer.**
   `resolve.classify()` labeled an attempt `no_answer_confirmed` purely
   because it had both `started_at` and `completed_at` set, never checking
   whether they were *identical* (zero ring time) or whether the attempt
   carried its own `failure_code`. A provider that never connected the call
   and a recipient who chose not to pick up are different events, and an
   institution should retry them differently. Fixed with a distinct
   `connection_failed_during_attempt` outcome
   (`tests/test_resolve.py`, `fixtures/21_connection_failed_during_attempt.json`).
2. **`region`/`locale` were never sent at all.** Calls to an
   international number CALL-E's own Supported Regions table documents
   failed at the provider layer with zero ring time. Every other app in
   this repo that places international calls sets these per recipient;
   `ringfence` did not. Fixed on `Case`, with defaults in `verify_call.py`
   (`tests/test_invariant_never_calls_request_supplied_number.py`).
3. **The audit trail's speaker labels were a guess.** `audit.py`'s Q&A
   extraction keyed off `speaker == "agent"` / `speaker == "recipient"` —
   labels that do not appear in a CALL-E transcript, where the agent side
   is `"bot"`. Every fixture and the synthetic corpus had the same
   unverified guess baked in. The bug was silent and total: it would have
   produced an *empty* Q&A trail for any real call, including a fully
   successful one — the exact opposite of the audit feature's purpose.
   Fixed to key off the real label, with anything else treated as the
   recipient side rather than a second hardcoded string
   (`tests/test_audit.py`).
4. **A vague caller identity was refused outright.** CALL-E's own
   content-policy layer rejected a task that described the caller only as
   "their financial institution," asking which institution the call should
   identify as the requester so the recipient is not misled by a vague or
   hidden identity — which is itself one of the red-flag patterns this
   project screens callers for. Fixed with an optional
   `Case.institution_name` (default `"Fictional National Bank"`, per this
   repo's fictional-demo-data convention), named explicitly in the rendered
   task.

Bugs 1 and 3 are the substantive ones: both were invisible to fixtures,
because the fixtures encoded the same wrong assumptions the code did.

## Demo: two-sided simulation

The real system above (`case submit`, the webhook, MCP) is the actual
integration surface an institution would use — but it's not a visual demo.
[`ringfence/demo_server.py`](ringfence/demo_server.py) adds a small,
dependency-light, two-sided *simulation* on top of it, purely for showing
the mechanism end to end in a demo video.

**This server has no live-call path at all.** It never imports a CALL-E
client, never reads `CALLE_API_KEY`, and contains no code that could place
an outbound call — asserted structurally, not just behaviourally, by
`tests/test_demo_server.py`'s `test_this_server_has_no_live_call_path_at_all`.
It also collects **no phone number**: there is no field for one and nothing
stores one. This is the surface that gets deployed to a public URL, and a
publicly reachable page that can dial a number an anonymous visitor typed
is not a defensible thing to operate. Real calls live only behind the
operator-run surfaces that require doubled confirmation per call (see
"Side effects" below).

What is real in the demo is the decision: a recorded scenario from
[`fixtures/`](fixtures/) is run through the actual `resolve.classify()` and
`decide()` modules, and the resulting recommendation — including its
`requires_human_review` flag — is what both pages display.

The customer page (`demo/customer.html`) uses
[Alpine.js](https://alpinejs.dev/) (one CDN `<script>` tag, ~15KB, no build
step) for its state — declarative `form`/`pending`/`resolved` views instead
of hand-rolled `getElementById`/`innerHTML`, and the in-flight case id is
persisted to `localStorage` so a page refresh while a verification is still
resolving picks the right view back up instead of dropping to a blank form.
The bank dashboard (`demo/bank.html`) stays plain JS deliberately — it has
no per-viewer state to lose on a refresh, it just re-renders from a fresh
`GET /api/demo/cases` every poll.

- **Customer side** (`/`) — a "send money" form: name, recipient, amount,
  payment method. **The customer never decides whether a verification call
  happens** — there is no scenario picker, no call button, no checkbox.
  That decision belongs entirely to the bank, exactly like the real product
  (`webhook.py`: an institution's own fraud system decides what's flagged,
  RingFence never does).
- **Bank side** (`/bank`) — a fraud-ops dashboard listing every submitted
  case, updating live, with a click-through to the full audit trail (what
  was asked, what was answered, which signals fired, why). Every row is
  labelled as a recommendation awaiting an analyst; the dashboard never
  presents a transaction as approved, held, or released.

```bash
python -m ringfence.demo_server --port 8090
# customer: http://127.0.0.1:8090/
# bank:     http://127.0.0.1:8090/bank
```

**The bank's decision is automatic and has exactly one policy**: any
transaction at or above `AUTO_APPROVE_BELOW_AMOUNT` ($1,000) requires
verification; anything below needs no call at all and is recorded as
`NO_VERIFICATION_REQUIRED` — deliberately *not* one of `decide.py`'s
recommendations, since no call happened and there is nothing for a human to
review. When verification is required, it runs immediately and
automatically, with no button on either side, against a randomly-picked
recorded scenario (there is no live-call sandbox to demo against safely —
CALL-E has no test/dummy-number mode). The audit trail shown reflects
whatever was actually typed into the customer form, not the scenario's own
placeholder case details.

### Deploying the demo publicly

Simulation mode has no external dependencies (pure stdlib + static
HTML/JS) — it runs anywhere Python 3.11+ runs, no database, no build step:

```bash
export RINGFENCE_DEMO_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python -m ringfence.demo_server --host 0.0.0.0 --port "$PORT"
# then open:  https://<your-host>/?token=<that value>
```

- **Any bind reachable from outside the machine requires a token.** With
  `--host` set to anything but loopback and `RINGFENCE_DEMO_TOKEN` unset,
  `main()` **refuses to start** and says why — an unauthenticated public URL
  cannot happen by forgetting an environment variable
  (`tests/test_demo_server.py`). When the token is set, every page and
  every API route requires it: `Authorization: Bearer <token>`, a `?token=`
  query parameter once per browser, or the `HttpOnly` cookie the pages set
  from that parameter. Anything else gets `401`. The one exception is
  `GET /healthz`, which returns `{"status": "ok"}` and nothing else, so a
  platform health check can run without credentials.
- **Run from a checked-out copy of this repo, not a `pip install`ed
  package elsewhere.** `fixtures/` and `demo/` are sibling directories
  looked up by relative path (`Path(__file__).resolve().parent.parent`),
  and `pyproject.toml`'s `packages.find` only includes `ringfence*` — they
  are **not** bundled into a built wheel. Deploy by cloning the repo onto
  the host and running from `apps/python/ringfence/`.
- `--port` falls back to the `$PORT` environment variable most PaaS
  platforms inject, if `--port` isn't passed explicitly.
- There is nothing sensitive behind the token by design — every case is
  either fixture-derived fictional data or whatever cosmetic fields a
  visitor typed in themselves — but the deployment is gated anyway, because
  "there's nothing sensitive in it *today*" is not a property that survives
  someone pointing different data at the same code.
- `DemoStore` is in-memory per process: fine for a single instance, but a
  restart clears the case list and it won't share state across multiple
  autoscaled replicas.

---

## Safety

- **The invariant above** — tested explicitly, not just documented.
- **Consent**: the institution's own account-holder agreement already
  covers being called by the institution — `ringfence` calls on the
  institution's behalf using their on-file number, which is the same
  consent basis their existing "we noticed unusual activity" calls already
  rely on.
- **No harassment**: one verification attempt per case by default, no
  automatic re-dial loop; resubmitting the same `case_id` returns the
  existing record rather than placing a second call — a blocked/declined
  case requires the institution to submit a **new** case deliberately.
- **Redaction**: account numbers, transaction amounts, and phone numbers are
  masked/redacted in all logs, stored records, and API responses
  (`ringfence/safety.py`) — this data is more sensitive than a generic
  contact list, treated accordingly.
- **Fictional-only demo data**: fictional account numbers, fictional
  institutions, fictional transaction amounts throughout — this is not, and
  does not imply itself to be, a real bank's real product.
- **No real live calls unsupervised**: every test, fixture, and example in
  this repo runs against dry-run/fixtures/mocked clients. A real call
  requires explicit, doubled confirmation on every surface (see below), and
  the one deployable surface (the demo server) has no live-call path at all.
- **Advisory, never automatic**: no output of this project is an action on
  money. Every recommendation carries `requires_human_review` and the
  institution's own reviewer decides — see "Advisory only — a human
  decides" above.

---

## Side effects

| Surface | Default behaviour | To place a real call |
|---|---|---|
| `ringfence case submit --file case.json` | Dry run. Renders the disclosure-first call script, resolves the dial target, validates the case. **No call placed, no credits spent.** | `--live --confirm-live` together — **both required, no override.** `CALLE_API_KEY` must also be set. |
| `ringfence case resolve --from-fixtures DIR` | Reads local JSON only. No network call, no API key needed. | N/A — read-only. |
| `POST /cases` (webhook) | Dry run, unless the server itself was started with `--live --confirm-live`. | Start `ringfence.webhook` with `--live --confirm-live`; live mode is loopback-only. Do not expose it through a public proxy. |
| `ringfence_submit_case` (MCP) | Dry run. | Pass `live=True` **and** `confirm_live=True` together in the same tool call — omitting either keeps it a preview. |
| `GET /cases/{id}` / `ringfence_get_case` | Read-only lookup of a stored recommendation. | N/A. |
| `ringfence case audit` / `case report-index` | Reads local JSON only, writes a report file. No network call. | N/A — read-only. |
| `ringfence.demo_server` | Simulation only, always. Replays a recorded scenario through the real decision modules. | **Not possible** — this server has no live-call path, by construction. |

No recurring schedules and no background jobs are created by any surface.
Only call numbers the submitting institution has independent, documented
authorization to call.

**No surface acts on the money.** Every one of them returns an advisory
recommendation for a human at the institution to act on, never an approve
or hold instruction — see "Advisory only — a human decides" above.

**Durability**: the webhook's `CaseStore` is backed by a durable, append-only
`CaseLedger` (`ringfence/ledger.py`) by default — every case survives a
process restart, and a case already dialed before a crash is never re-dialed
after one (`tests/test_crash_safety.py`). Pass `--no-persist` to
`ringfence.webhook` to keep the store in-memory only.

---

## Setup

```bash
cd apps/python/ringfence
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
# for the webhook/MCP surfaces:
.venv/bin/pip install -e '.[webhook,mcp]'
export CALLE_API_KEY="your-key"   # only needed for --live
# only needed to expose the demo server beyond loopback:
export RINGFENCE_DEMO_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

Get a key at [dashboard.heycall-e.com](https://dashboard.heycall-e.com). The
key is read from the environment only.

---

## Usage

**Dry run** — the default, and the recommended first step:

```bash
python -m ringfence.cli case submit --file example_case.json
```

```
ringfence case submit · case=case_example_001 · DRY RUN — nothing is dialed

  dial target : +*********01
  status      : previewed
  detail      : goal rendered (949 chars); DRY RUN, no call placed
```

**Live run** — requires both flags together:

```bash
python -m ringfence.cli case submit --file example_case.json \
  --live --confirm-live
```

**Resolve** a batch of fixture-shaped case records (call + attempts + events
+ structured signals) into recommendations, with a redacted audit report:

```bash
python -m ringfence.cli case resolve --from-fixtures fixtures/
```

```
ringfence resolve · 21 case(s)

  01_clean_legitimate_contractor_payment   outcome=answered_success                 -> ADVISE_ALLOW
      - clean_conversation_no_red_flags_explicit_confirmation
  03_scam_secrecy_demand                   outcome=answered_success                 -> ADVISE_BLOCK
      - secrecy_demand_present
      - urgency_pressure_present
      - relationship_not_explained
      - irreversible_payment_demanded
  ...

audit report -> results/case_dispositions.jsonl
```

**Audit** the full evidence trail for one case — what was asked, what was
answered, which red flags fired, and why:

```bash
python -m ringfence.cli case audit \
  --file fixtures/13_scam_ceo_fraud_secrecy_and_urgency.json \
  --out results/audit/case_f13.json --html results/audit_html/case_f13.html
```

```
RingFence case audit -- case_f13
========================================
...
Verification Q&A:
  1. Q: ...Did anyone ask you to keep this transaction private...?
     A: Yes, the message said to keep it confidential...
...
RECOMMENDATION: ADVISE_BLOCK
  reason: secrecy_demand_present
  reason: urgency_pressure_present
  reason: relationship_not_explained
  ADVISORY ONLY -- requires human review before any action is taken on this transaction.
```

Build a static, dependency-free HTML case index (no server, no auth) from a
directory of exported audit reports:

```bash
python -m ringfence.cli case report-index \
  --from-reports results/audit --out-dir results/audit_html
```

**Webhook** — an institution's fraud system integrates here. Durable by
default (`--no-persist` for in-memory only):

```bash
python -m ringfence.webhook --port 8080
curl -X POST http://127.0.0.1:8080/cases -d @example_case.json \
  -H 'Content-Type: application/json'
curl http://127.0.0.1:8080/cases/case_example_001
```

**MCP** — for an agent host or orchestrator:

```bash
python -m ringfence.mcp_server
```

---

## Options

### `case submit`

| Flag | Default | Purpose |
|---|---|---|
| `--file` | *required* | Path to a case JSON file (see `example_case.json`) |
| `--live` | off | Place a real call |
| `--confirm-live` | off | Required alongside `--live` — explicit, separate confirmation |
| `--security-log` | `results/security_events.jsonl` | Where a smuggled-callback-number event is recorded |

### `case resolve`

| Flag | Default | Purpose |
|---|---|---|
| `--from-fixtures` | *required* | Directory of `{case,call,attempts,events,signals}` JSON files |
| `--out` | `results/case_dispositions.jsonl` | Redacted audit report path |

### `case audit`

| Flag | Default | Purpose |
|---|---|---|
| `--file` | *required* | A `{case,call,attempts,events,signals}` JSON record (fixture format) |
| `--out` | none | Write the JSON audit report here |
| `--html` | none | Also write a static HTML case-report page here |

### `case report-index`

| Flag | Default | Purpose |
|---|---|---|
| `--from-reports` | *required* | Directory of JSON audit reports (from `case audit --out`) |
| `--out-dir` | `results/audit_html` | Where the per-case HTML pages + `index.html` are written |

### `ringfence.webhook`

| Flag | Default | Purpose |
|---|---|---|
| `--ledger-path` | `results/case_ledger.jsonl` | Durable, append-only case ledger — survives a restart |
| `--no-persist` | off | Keep the case store in-memory only (state lost on restart) |

---

## Self-review

A full adversarial review pass was run against this branch's diff before
calling it done. It found, and this codebase now fixes:

- `decide()`'s clean branch checked only 2 of the 5 signals
  (`relationship_explained`, `explicit_hold_requested`) — a
  partially-populated verification-call result (the other three fields
  simply absent) could reach `ADVISE_ALLOW` despite the module's own "fails
  closed at every branch" claim. Now every signal that branch depends on
  must be explicitly present and clean (`tests/test_decide.py`).
- `Case.from_dict` never validated its phone fields, so a malformed number
  crashed uncaught deep inside `resolve_dial_target` instead of surfacing as
  a clean error at every entry point.
- The webhook's case-creation and dial-placement were non-atomic under
  `ThreadingHTTPServer` — a concurrent retry of the same `case_id` could
  place two real dials for one case. The record is now reserved atomically
  before any call is placed (`tests/test_webhook.py`'s concurrency test).
- A live call ending in `ERROR`, or completing with no `call_id` in CALL-E's
  response, left the recommendation null forever with no signal to the
  institution (this `case_id` can never be re-dialed by design) — both now
  escalate explicitly instead.
- A malformed `Content-Length` header crashed the webhook handler; one
  malformed fixture record killed `case resolve`'s entire batch instead of
  just that record.
- The four bugs that came out of exercising the live API rather than
  reviewing the code are described in "Validation against the live API"
  above: the connection-failure/no-answer conflation, the never-sent
  `region`/`locale`, `audit.py`'s guessed speaker labels, and the
  unnamed-institution content-policy refusal. Two of them (the first and
  third) were invisible to the fixture corpus, because the fixtures
  encoded the same wrong assumption the code did.

**Not fixed, left as a known limitation**: `webhook.py`'s live path makes
two extra CALL-E API round-trips (`client.calls.get` + `list_events`) to
re-fetch data `create_and_wait` already had, using a client-holder closure
to smuggle the constructed client out of `place_verification_call` rather
than threading the completed call through directly. Real inefficiency, not
fixed here — noted rather than silently left out of this section.

## Known limitations

- `resolve.classify()` reads the first recipient's first attempt only, same
  documented limitation as `calltruth` — a natural next step for a
  multi-recipient case.
- This is a fixed, illustrative fixture corpus (see "Measured evaluation"
  above) — not a statistically representative sample of real fraud calls.
- See "Self-review" above for the one known-but-unfixed inefficiency.
- Sending `region`/`locale` (see "Validation against the live API" above)
  was a real, necessary fix, but it did not by itself guarantee a connected
  call: attempts to the same supported international route continued to
  fail intermittently afterwards, with differing provider error codes and
  zero ring time, including one code seen before the fix existed. Stated
  plainly rather than overclaiming that a one-line fix solved what looks
  like carrier-level flakiness neither this app nor CALL-E's own docs
  explain.
- `audit.py`'s Q&A pairing is 1:1 on individual transcript lines, not on
  semantic turns, which makes for a noisy report: short backchannel agent
  lines ("Thanks.", "Okay.") each generate their own spurious "(no answer
  recorded)" entry, so the four real questions sit among many more
  entries. The recommendation and signal extraction are unaffected and
  correct; this is a report-clarity issue, not fixed here. A real fix would
  group consecutive agent lines into one question before pairing with the
  next recipient reply.
- The demo server is simulation-only by design (see "Demo" above), so the
  deployable surface does not exercise the live call path. That path is
  covered by the operator-run CLI/webhook/MCP surfaces and their tests.
