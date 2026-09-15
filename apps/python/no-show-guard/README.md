# No-Show Guard

> **"CALL-E: Your Code Is Calling"** — automatic appointment confirmation
> calls that stop the no-shows.

No-Show Guard is a small, installable Python application that helps clinics,
salons, and service businesses **cut missed appointments** by automatically
placing an AI outbound confirmation call to each customer ~24 hours before
their booking. The CALL-E agent on the phone confirms the customer's identity,
reads out the appointment, and captures whether they want to **Confirm**,
**Reschedule**, or **Cancel** — then the app stores the structured result and
tells staff exactly what to do next.

---

## The problem it solves

Missed appointments are expensive. Every "no-show" is lost revenue, a wasted
time slot, and a gap in the calendar staff can't fill at the last minute.
Studies routinely show that **confirmation calls dramatically reduce no-show
rates** — but calling each customer manually doesn't scale for a busy clinic.

No-Show Guard automates the whole loop:

1. **Load** upcoming appointments (name, phone, date/time, service).
2. **Call** each customer 24 hours beforehand using the real CALL-E API.
3. **Capture** a structured outcome (confirmed / rescheduled / cancelled /
   no answer) from the AI agent.
4. **Act** — log reschedule requests for staff, retry no-answers, and report.

---

## How it works

```
                 +----------------------------+
appointments |  sample_appointments.csv   |   (or any CSV)
   (input)      +-------------+--------------+
                              |
                              v
                    +------------------+
                    |   scheduler.py    |  picks appointments due for a call
                    +------------------+
                              |
                              v
                    +------------------+      calle-ai SDK
                    |   call_agent.py   |  CalleClient.calls
                    +------------------+  .create_and_wait(task, schema)
                              |                |
                              |                v
                              |          CALL-E AI agent
                              |          (speaks to customer)
                              v
                    structured result (task_completed, completion_confidence)
                    +---------+---------+
                    |   call_agent.py   |  maps sdk call -> CallOutcome
                    +---------+---------+
                              |
                              v
                    +------------------+        +-------------------+
                    |     db.py        | -----> |  appointments.db  |
                    |  (SQLite)        |        |  (calls + results)|
                    +------------------+        +-------------------+
                              |
                              v
                    +------------------+        +-------------------------+
                    |   report.py      | -----> |  console table + CSV    |
                    +------------------+        |  daily summary          |
                                                +-------------------------+
```

**Flow in a nutshell:** `scheduler` finds who to call → `call_agent` talks to
CALL-E (create + poll) → `db` persists the outcome → `report` sums up the day.
A `--dry-run` flag simulates calls locally so you can develop without dialing.

---

## Project structure

```
noshow-guard/
  noshow_guard/
    __init__.py       # package metadata
    config.py         # env loading + settings
    prompts.py        # configurable agent call script + result schema
    call_agent.py     # CALL-E API client (create + poll calls)
    db.py             # SQLite models + helpers
    scheduler.py      # decides which appointments need a call today
    report.py         # daily summary (console + CSV)
    cli.py            # entry point
  sample_appointments.csv
  .env.example
  requirements.txt
  README.md
```

---

## Setup

### 1. Get a CALL-E account & API key

1. Sign up for a CALL-E account.
2. Create an API key from your dashboard.
3. Keep it private — never commit it to git.

### 2. Install

```bash
cd noshow-guard
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure the environment

```bash
cp .env.example .env
# edit .env and paste your key
```

At minimum set:

```
CALLE_API_KEY=your_calle_api_key_here
```

Other useful knobs (all in `.env.example`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `CALLE_API_KEY` | *(none)* | Your CALL-E API key (read by the SDK) |
| `CONFIRMATION_HOURS_BEFORE` | `24` | Hours before the appointment to call |
| `CALLE_REGION` / `CALLE_LOCALE` | `IN` / `en-US` | Caller region + language |
| `MAX_RETRIES` | `2` | Max retry attempts for no-answer |
| `RETRY_HOURS_APART` | `2` | Hours between retries |
| `DATABASE_PATH` | `appointments.db` | SQLite file |
| `APPOINTMENTS_CSV` | `sample_appointments.csv` | Input CSV |

---

## How to run

```bash
# 1) Create the database and import the sample appointments
python -m noshow_guard init

# 2) Safely test the whole pipeline WITHOUT dialing (no API key needed)
python -m noshow_guard run --dry-run

# 3) Run for real — dials today's due appointments via CALL-E
python -m noshow_guard run

# 4) Inspect the database
python -m noshow_guard status
```

Arguments for `run`:

| Flag | Meaning |
|------|---------|
| `--dry-run` | Simulate calls locally (no dialing, no API key required) |
| `--report-csv PATH` | Also write a CSV audit report to `PATH` |

---

## Example report output

Console summary produced by `python -m noshow_guard run`:

```
====================================================
  No-Show Guard — Daily Call Summary
  Generated: 2025-12-19 10:02:11 UTC
====================================================
+--------------+-------+
|    Metric    | Count |
+--------------+-------+
| Total calls  |   5   |
| Confirmed    |   2   |
| Rescheduled  |   1   |
| Cancelled    |   1   |
| No answer    |   1   |
+--------------+-------+

Awaiting staff review — customers who asked to RESCHEDULE:
+---------------+----------------+---------------------+------------------+
|     Name      |     Phone      |      Original       |  Requested new   |
+---------------+----------------+---------------------+------------------+
| Rohan Mehta   | +919930345603  | 2025-12-21 09:15    | 2025-12-28 15:00 |
+---------------+----------------+---------------------+------------------+

Full audit CSV written to: appointments_report.csv
```

---

## Real CALL-E integration

`call_agent.py` uses the **official CALL-E Python SDK** (`calle-ai`) for
authentication and placing calls. The SDK is initialised with your
`CALLE_API_KEY`:

```python
from calle import CalleClient

client = CalleClient(api_key="YOUR_KEY")
call = client.calls.create_and_wait(
    task=task_prompt,
    result_schema=RESULT_SCHEMA,
)
```

The SDK fully manages authentication, calling the CALL-E agent, and waiting
for a structured result. The returned `call` dict exposes:

| Field | Meaning |
|-------|---------|
| `call["status"]` | e.g. `completed`, `failed`, `no_answer` |
| `call["structured_result"]` | The parsed JSON per your `result_schema` |
| `call["task_completed"]` | Whether the agent completed the task |
| `call["completion_confidence"]` | Confidence score (float) |
| `call["evidence"]` | Transcript / supporting detail |

**Key details handled for you:**

- **Auth** — handled by the SDK using `CALLE_API_KEY`.
- **Result schema** — the app tells CALL-E exactly what JSON to return
  (`outcome`, `new_datetime`, `cancel_reason`), so results are structured and
  safe to parse. The app maps `structured_result` onto its `CallOutcome` type.
- **No mock at runtime** — `python -m noshow_guard run` genuinely dials via
  the SDK; only the explicit `--dry-run` flag simulates calls for safe local
  testing.

### The agent's call script

The prompt sent to the AI agent lives in **`prompts.py`** (`TASK_TEMPLATE`).
It instructs the agent to confirm identity, read out the appointment, and ask
for Confirm / Reschedule / Cancel. Change it there to demo a different agent
behaviour — no other code changes needed.

---

## Error handling

- **Missing/invalid phone numbers** are rejected before a call is created.
- **API failures & rate limits** raise `CallError` with a clear message; the
  CLI catches them, reports the error, and marks the appointment so it can be
  retried on a later run.
- **No-answer** appointments are automatically queued for retry (default
  `MAX_RETRIES=2`, `RETRY_HOURS_APART=2` hours).
- **Exhausted retries** — after `MAX_RETRIES` no-answers, the appointment is
  marked `call_failed` and surfaced in the report for staff to call manually.

---

## Contribution to awesome-phone-call-agents

This project is structured as an **installable, reusable module** (not a bare
script) so it can be published as an Agent Skill / Workflow Plugin
contribution. It is self-contained: the official `calle-ai` SDK,
`python-dotenv`, and `prettytable` only, with a clear `prompts.py` seam for
customising agent behaviour and a `--dry-run` mode for safe demoing.

---

## Testing the pipeline locally

No phone, no API key? Use dry-run:

```bash
python -m noshow_guard init
python -m noshow_guard run --dry-run
```

This runs the full scheduler → database → report loop with simulated outcomes,
so you can verify the report, the SQLite updates, and the retry logic end to
end before enabling real calls.
