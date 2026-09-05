# VisitLock

VisitLock is maintained in the upstream repository: [https://github.com/moscraciunxxx/visitlock-calle](https://github.com/moscraciunxxx/visitlock-calle).

This directory is a catalog pointer for Awesome Phone Call Agents.

## What it does

Batch-confirm clinical research visit slots by phone with CALL-E. Loads a CSV of study visits, places disclosed confirmation calls (or fixture results), records structured RSVPs (`yes` / `no` / `reschedule` / `no_answer`), keeps an idempotent dial ledger, and refreshes a confirmation_rate HUD.

## Portable skill

Agent workflow: [`skills/visitlock`](../../../skills/visitlock/).

## Setup

Clone the upstream repo, then:

```bash
pip install -e .
python -m visitlock demo          # fixture + local HUD
python -m visitlock run --csv ... # fixture or live
```

Dry-run / no-call path is the default when `CALLE_API_KEY` is unset. Fixture mode works offline without a key.

## Side effects

Live mode places outbound phone calls via CALL-E. Use authorized numbers only. Samples use fictional or masked phones.

## Cancellation

Stop the CLI to halt further dials. The dial ledger prevents re-dial of completed `participant_id::visit_datetime` keys on re-runs. There are no hidden recurring schedules.

## Tests

```bash
PYTHONPATH=. python -m unittest discover -s tests -v
```
