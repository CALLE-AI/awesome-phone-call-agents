# Cortex Call Brain

A runnable CALL-E app that gives an outbound phone agent a **persistent, curated
two-tier memory** — so every call makes the next one smarter, and knowledge
learned from one caller can safely help future callers.

The reference workflow is a **pharmacy / clinic medication-adherence check-in**:
the agent calls a patient, asks how they are getting on with a medicine, and
returns structured notes. Cortex adds memory on top of that:

- a **sub-brain per caller** (private summary + open items + callback context)
- a shared **master brain** of facts and anonymized signals learned across
  everyone, guarded so no single caller can poison it
- a **human-in-the-loop approval** step before the agent starts proactively
  asking about a newly learned pattern

This app is a runnable demo, not an SDK or a supported product API.

## What it does on a call (side effects)

- Places **real outbound phone calls** through the CALL-E CLI when run with
  `--execute` / a live campaign. Every call is a real side effect.
- Writes a local SQLite brain (`cortex.db`): per-caller summaries, learned
  facts, aggregate signals, and a call log.
- Never diagnoses, never gives medical or dosage advice — it listens, notes, and
  flags patterns to staff. Safety rules are appended to every call goal and are
  documented in `../../../skills/adherence-memory-callback/references/safety.md`.

Phone numbers in this repo are fictional reserved samples (for example
`+12025550100`), and are masked in all console output and in the dashboard.

## Requirements

- Python 3.10+
- The CALL-E CLI (`calle`) logged in, for live calls only:
  `npm install -g @call-e/cli` then `calle auth login`
- A Gemini API key is **optional** — without one the app runs fully offline
  (rule-based extraction + local hash embeddings), which is enough for the
  dry-run and the seeded demo.

CALL-E CLI parameters and command flags are documented in the CALL-E
integrations repository.

## Setup

```bash
cd apps/python/cortex-call-brain
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # optionally add a GEMINI_API_KEY; never commit .env
```

## Usage

### 1. Dry run — build the call goal, place NO call (default-safe path)

```bash
python -m cortex.run_campaign --demo --dial +12025550100 --drug Metformin --dry-run --ignore-quiet
```

This prints the exact instruction the agent would be given for each caller,
including the safety rails, without dialing anything. **No-call is the default** —
even without `--dry-run`, nothing is dialed unless you also pass `--execute`.

### 2. Seed a demo brain from sample transcripts (no calls)

```bash
python seed_demo.py           # writes cortex.db from fictional sample calls
```

### 3. Open the dashboard (operator console + brain map)

```bash
streamlit run dashboard.py
```

Shows the master brain (candidate vs canonical facts), the per-caller
sub-brains, the staff-alert signals, the admin prompt-approval panel, and a live
graph of the whole brain. It opens the database **read-only for display** and
only writes when an admin approves or dismisses a proposed prompt change.

### 4. Live call (real outbound call — opt-in, multiple explicit gates)

```bash
# authorize the number(s) you may call, then dial with explicit consent + execute
export CORTEX_ALLOWED_DIAL="<E164-number>"
python -m cortex.run_campaign --phone +12025550100 --dial <E164-number> \
  --name "Patient" --drug Metformin --consent --execute
```

A live call is placed **only** when ALL of these hold: `--execute` is passed (not
`--dry-run`); the dialed number matches a **non-empty** `CORTEX_ALLOWED_DIAL`
allowlist; and consent is explicit (`--consent` for ad-hoc `--phone`/`--demo`
calls, or per-patient `consent` in a roster file). A self-supplied number is
never treated as consent, and an empty allowlist fails closed. The demo and
`seed_demo.py` never place calls.

## Safety, cancellation, and rollback

The orchestrator (`cortex/run_campaign.py`) runs these **fail-closed** guards
before any dial, in this order:

1. **No-call default** — a real call is placed only with an explicit `--execute`;
   omit it and nothing is dialed.
2. **Authorized destination** — a live dial must be strict E.164 AND match a
   **non-empty** `CORTEX_ALLOWED_DIAL` allowlist; an empty allowlist fails closed.
3. **Explicit consent** — a caller with `consent=false` is never called, and a
   self-supplied `--phone`/`--demo` number is not consent (pass `--consent`, or
   use per-patient consent in a roster). No flag bypasses a missing consent.
4. **Quiet hours** — no calls inside `CORTEX_QUIET_HOURS` (region-local). Only an
   interactive operator may pass `--ignore-quiet`.
5. **Idempotency** — the same caller identity is not dialed twice within
   `CORTEX_MIN_RECALL_HOURS`, and never twice in one run. This prevents
   double-dialing if the script is re-run.
6. **Call cap** — at most `CORTEX_MAX_CALLS` (default 50) real calls per run; the
   campaign stops when it is reached. This bounds blast radius regardless of cost.
7. **Budget** — before each call, `spent + estimated cost` must stay under
   `CORTEX_BUDGET_USD`. Note this only bites when `CORTEX_COST_PER_CALL > 0`; with
   the default cost of 0 the money budget is inert, which is why the call cap
   above is the primary bound. Crossing the budget **stops the whole campaign**.

If a call never reaches a terminal state (polling times out with no transcript),
the campaign **halts for reconciliation** — it does not learn from or advance
past an inconclusive result. Phone numbers are masked in all console output and
in the dashboard; caller source ids are keyed-HMAC (set `CORTEX_HASH_SECRET`, or
a per-DB random secret is used).

There are no hidden or recurring schedules: this app dials only when you run it.
To cancel, stop the process; no background jobs are created.

Rollback / data control:

- `Memory.forget_patient(phone)` erases a caller's entire sub-brain **and their
  call-log rows** (raw number, summary, transcript). The anonymized master brain
  is unaffected — it holds no attributable personal data, only hashed sources.
- An admin can `Dismiss` or `Revoke` any learned prompt change from the
  dashboard, or in code via `Memory.dismiss_signal` / `Memory.revoke_signal`.

## Credentials

- The CALL-E CLI holds its own OAuth token from `calle auth login`; this app
  does not read or store it.
- `GEMINI_API_KEY` is read from the environment / `.env` only. No secrets are
  committed; `.env` is git-ignored and only `.env.example` ships.

## Tests / manual verification

An offline invariant test-suite pins every safety property (no-call default,
exact-match allowlist, explicit consent, inconclusive-halts, corroboration gate,
keyed-HMAC ids, HTML/script escaping, free-text clamping, reserved sample
numbers). No calls, no key:

```bash
pip install -r requirements-dev.txt
python -m pytest -q                 # 23 invariant tests
python -m bandit -r cortex --severity-level medium   # security lint (clean)
python -m ruff check --select F,B,E9 cortex           # real-bug lint (clean)
```

Each core module also has a self-check:

```bash
python -m cortex.memory      # corroboration gate: candidate -> canonical
python -m cortex.learn       # transcript -> structured facts + signals
python seed_demo.py          # full learn pipeline into a demo brain
python -m cortex.run_campaign --demo --dial +12025550100 --dry-run --ignore-quiet
```

Expected: `cortex.memory` promotes a fact only after a second **distinct** source
corroborates it; `seed_demo.py` ends with one canonical fact and the rest as
candidates.

## Layout

```
cortex-call-brain/
├── README.md
├── requirements.txt
├── .env.example
├── seed_demo.py            # build a demo brain from sample transcripts (no calls)
├── dashboard.py            # Streamlit operator console + brain map
└── cortex/
    ├── memory.py           # two-tier store + corroboration gate + approval lifecycle
    ├── learn.py            # transcript -> structured knowledge (Gemini or rules)
    ├── brain.py            # assemble the next call's goal from memory + safety rails
    ├── caller.py           # CALL-E CLI wrapper (persists run_id/recovery_id)
    ├── run_campaign.py     # orchestrator with consent/quiet/idempotency/budget guards
    └── llm.py              # Gemini JSON helper (optional)
```
