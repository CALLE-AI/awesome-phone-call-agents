# hivemind-closer

Mock-first lead-qualifier demo: a deterministic bargaining matrix folds one
CALL-E call result into a per-lead board with a graceful-exit rule.
Aggressive follow-up is never automatic — ambiguous outcomes stay `active`
with capped persistence, and any opt-out or annoyance signal exits that lead
immediately with no redial.

**Honest scope label: the bargaining matrix is HEAVILY MOCKED.** The matrix
core (`matrix.py`) and budget gate (`budget.py`) are pure, deterministic
Python with no I/O. The only live CALL-E surface in this demo is one
human-gated outbound call whose structured result (`interested`, `opt_out`,
`callback_window`, transcript) is folded into the board. This app ships the
preview path and the gated live entrypoint; it does not automate dialing,
redialing, or scheduling.

## Setup

Requires Python 3.14+ and pip. No CALL-E key needed for the default path.

```bash
cd apps/python/hivemind-closer
pip install -r requirements.txt
cp .env.example .env   # leave CALLE_API_KEY empty for preview
```

## Usage

Dry-run preview (default, zero spend, zero network):

```bash
PYTHONPATH=. python -m hivemind_closer.cli preview
```

Expected output (also saved in [`examples/dry_run.json`](examples/dry_run.json)):

```text
hivemind-closer dry-run (spend: 0 calls)
  [  0] state=active        aggression=1 offer=0.00
  [  1] state=active        aggression=0 offer=0.00
  [  2] state=active        aggression=0 offer=0.00
```

The canned fixture means "reached voicemail", so row 0 stays `active` with
aggression raised by one (capped at 2). An `interested=yes` result would mark
that row `closed`; an opt-out or annoyance signal would mark it
`graceful_exit` with no redial.

Readiness probe (mock mode boots with no credentials):

```bash
uvicorn hivemind_closer.api:create_app --factory --port 8001
curl -s http://127.0.0.1:8001/health
curl -s http://127.0.0.1:8001/ready
```

## Side effects

- `preview` has no side effects: no calls, no network, no files written.
- The gated `live` entrypoint (`python -m hivemind_closer.cli live`) refuses
  without human approval, typed number confirmation, and remaining budget —
  in this demo it dials nothing and exits non-zero by design.
- A real live run (outside this demo) places exactly one outbound phone call
  per explicit human approval. There is no auto-redial, ever.

## Credential handling

- Credentials live only in `.env` (gitignored; see `.env.example`). Never
  commit `.env`, never paste keys into issues or logs.
- Mock/preview mode requires no credentials and fails closed: setting
  `CALL_E_MODE=live` without `CALLE_API_KEY` raises at startup instead of
  dialing.
- Logs are JSON with secret and phone-number redaction (`logging.py` masks
  digit runs and key material before any handler sees them).

## Dry-run / preview

`preview` is the default and the CI contract: it runs the full
seed-matrix → canned-result → board-update loop in-process. No API key, no
server, no spend. `examples/dry_run.json` is the real output of that command,
not a hand-written sample.

## Cancellation and budget gate

- There is no recurring schedule in this app (nothing to cancel) and no
  provider-side recurrence. One approval equals at most one call.
- The lifetime budget gate (`budget.py`, 20 live calls max) is enforced in
  code: once the counter is spent, further live slots raise
  `BudgetExhaustedError`. A corrupt counter file fails closed to fully spent.
- CALL-E offers no cancel-after-accept endpoint, so the safety boundary is
  placed *before* dialing: explicit intent, exact E.164 destination in
  `+1555xxxxxxx` fictional test ranges for fixtures, human confirmation, and
  remaining budget are all required before any create call.

## Content boundaries

Lead-qualification calls only. No medical, legal, financial-advice, or
emergency content. Voicemail is reported as not-reached, never as consent or
interest. Phone numbers in samples are fictional (`+1555xxxxxxx` range) and
masked in logs.

## Layout

```text
hivemind-closer/
├── README.md
├── LICENSE (MIT)
├── requirements.txt
├── .env.example
├── hivemind_closer/
│   ├── matrix.py    # pure deterministic bargaining core (HEAVILY MOCKED)
│   ├── budget.py    # pure 20-call lifetime budget gate
│   ├── cli.py       # preview (safe) + gated live entrypoint
│   ├── settings.py  # env-bound config, fail-closed without key
│   ├── logging.py   # redacting JSON logs
│   └── api.py       # /health + /ready viewer
└── examples/
    └── dry_run.json # real preview output
```
