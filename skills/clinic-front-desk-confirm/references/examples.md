# Examples

## Practice confirm (no network)

```bash
python -m appointment_confirm demo
```

Expected shape:

```json
{
  "outcome": "confirmed",
  "call": "dry-run",
  "phone": "***0123",
  "summary": "Maya Alvarez kept Thu 4:15pm at Lakeside Dental (***0123)."
}
```

## Practice cancel

```bash
python -m appointment_confirm demo --scenario declined
```

(If the CLI flag is unavailable, set `scenario=declined` via the UI or API body.)

## Live call (operator-owned number only)

```bash
export CALLE_API_KEY=...
# In the UI choose Real call, or POST mode=live with an authorized E.164.
```

## Companion product

Full FastAPI call desk: https://github.com/MNLABSUK/appointment-confirm
