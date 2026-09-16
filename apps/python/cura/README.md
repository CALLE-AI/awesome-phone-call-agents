# Cura

**Clinical trial adherence & adverse event monitoring via CALL-E outbound voice check-ins.**

Cura is a Django coordinator portal that schedules protocol-driven patient phone check-ins through the CALL-E Python SDK, ingests structured post-call results, and escalates high-risk symptoms to clinicians in real time.

> Full source: https://github.com/JamesMatata/Cura  
> This folder is the **hackathon contribution package** for [awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents) (Option B: slim app entry + link to full project).

## Why this helps AI-agent phone-call workflows

- Turns CALL-E into a **scheduled clinical outreach agent** with patient/trial context in the task prompt
- Returns **structured adherence + symptom + triage** payloads for downstream agent or dashboard action
- Includes **dry-run / simulation paths** so agents and reviewers can exercise the workflow without placing live calls

## Contribution type

| Field | Value |
|-------|--------|
| Area | Runnable app (`apps/python/cura`) |
| Runtime | Python 3.11+ / Django |
| CALL-E integration | Python SDK (`calle-ai`) at runtime |
| Default mode | **No live calls** (dry-run + webhook simulation) |
| Live calls | Opt-in only (API key + explicit Call now / schedule command) |

## Architecture (short)

```text
Trial + Patient (Django)
        ↓
schedule_calls / Call now  →  CALL-E SDK outbound dial
        ↓
Patient phone conversation
        ↓
Webhook → ingestion → triage → Alerts + Monitoring UI
```

## Side effects

When live mode is enabled, Cura can:

- Place **real outbound phone calls** via CALL-E
- Create / update `CallSession` records
- Schedule recurring check-ins (`generate_schedule` + `schedule_calls`)
- Store transcripts / clinical fields from webhook payloads

**Cancellation / rollback**

- Stop placing new calls: do not run `schedule_calls` / disable cron; leave `CALLE_API_KEY` unset for local demos
- Cancel in-progress CALL-E work from your CALL-E dashboard if needed
- Mark patients `withdrawn` / deactivate trial (`is_active=False`) to remove them from scheduling
- Acknowledge alerts in the UI without triggering follow-up unless you click **Trigger follow-up call**

## Safety

See [SAFETY.md](./SAFETY.md). Summary:

- Explicit coordinator intent required for live dials
- Use E.164 numbers; mask in logs/docs
- Never commit API keys or real PHI
- Not an emergency services system — emergency content is escalated to clinicians, not 911 automation

## Dry-run / no-call path (default)

These paths never require a live CALL-E dial:

```bash
# Preview who would be called
python manage.py schedule_calls --dry-run

# Seed fictional demo trial + patients (fictional E.164 numbers)
python manage.py seed_demo

# Simulate post-call AE / adherence webhook into the dashboard
python manage.py simulate_webhook --help
```

Run the portal UI and walk Alerts / Monitoring / call detail using simulated data only.

## Opt-in live verification

1. Create a CALL-E account and set `CALLE_API_KEY` in `.env`
2. Set a reachable `CALLE_WEBHOOK_URL` (deployed app or tunnel) to `/api/calls/webhook/`
3. Set a strong `CALLE_WEBHOOK_SECRET`
4. Enroll a test number you control
5. Use **Call now** on a patient, or:
   ```bash
   python manage.py schedule_calls --patient PT-001 --force
   ```
6. Confirm `CallSession` updates and webhook ingestion

## Setup (full app)

```bash
git clone https://github.com/JamesMatata/Cura.git
cd Cura
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_demo --create-superuser
python manage.py runserver
```

Demo login after seed: `admin` / `cura-demo-admin` (change before any shared deploy).

## Credentials

- Keep `CALLE_API_KEY` and webhook secrets in environment variables only
- Do not commit `.env`, SQLite with real call data, media uploads, or private transcripts
- Sample phones in seed data use fictional numbers

## License

MIT for the full Cura application. This contribution folder follows the parent awesome-phone-call-agents repository license.
