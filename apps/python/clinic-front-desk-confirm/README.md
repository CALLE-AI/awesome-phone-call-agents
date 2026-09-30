# Clinic Front Desk Confirm

Practice-first CALL-E appointment confirmation for clinics and practices.

- Skill: [`skills/clinic-front-desk-confirm`](../../../skills/clinic-front-desk-confirm/)
- Full product (UI + API): https://github.com/MNLABSUK/appointment-confirm

## Quick practice run

```bash
python3 client.py --practice
```

No network and no CALL-E credentials required. Prints a masked practice result.

## Full local UI

```bash
git clone https://github.com/MNLABSUK/appointment-confirm.git
cd appointment-confirm
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m appointment_confirm serve --host 127.0.0.1 --port 43148
```

Open http://127.0.0.1:43148 — practice mode is default; live calls need `CALLE_API_KEY` and an operator-owned number.
