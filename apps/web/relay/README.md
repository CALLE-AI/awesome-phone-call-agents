# Relay — Your Business, Optimized.

Relay is a proactive AI business-operations agent. It uses company-specific policies and business data to call employees, customers, and software owners through CALL-E, capture structured outcomes, and update the company's operational state.

**Everything in this app is automated by default.** A background engine checks real conditions — using actual `datetime` comparisons, not static flags — every `AUTOMATION_INTERVAL_SECONDS` and places calls on its own. See [Automation](#automation) below. Manual "Call" buttons still exist for demoing a specific scenario on demand, but nothing requires them.

## Stack

- React + Vite frontend
- Flask REST API
- SQLite database
- CALL-E for phone conversations
- Python `datetime` for real time-window checks (check-in deadlines, renewal windows) — not just for timestamps

## Demo login

- Email: `admin@relaydemo.com`
- Password: `demo123`

## Features

### Company workspace
- Company sign-in
- Demo company workspace
- Company-specific policies
- Policy upload for UTF-8 `.txt` / `.md` files
- Editable policy text
- Settings to enable/disable major Relay capabilities

### Dashboard
- Employee attendance: present, absent, late, remote, on leave
- Employee attention flags
- Upcoming meetings
- Company memos
- Customer renewals and account health
- Software inventory
- Monthly software spend
- Potential unused software spend
- Recent operational calls and activity

### Employee Operations
Each employee has:
- Present / absent / late / remote / on leave status
- Offboarding status
- Department
- Role
- Assigned software
- Upcoming meetings
- Phone number

Relay can call an employee to determine whether they are:
- On leave
- Working remotely
- Running late
- Forgot to check in
- Facing a problem requiring escalation

The structured result is written to SQLite and appears in the call log.

Offboarding can also reclaim an associated software seat, creating a cross-pillar workflow.

### Customer Lifecycle
Each customer has:
- Current plan
- Renewal date
- Customer status
- Recent issue
- Usage
- Contact number

Actions:
- Renewal call
- Plan information
- Issue follow-up
- Feedback call

### Software / Vendor Lifecycle
For each SaaS tool Relay tracks:
- Department
- Owner
- Purchased seats
- Active seats
- Utilization
- Cost per seat
- Monthly spend
- Renewal date
- Potential unused monthly spend

Formula:

`unused seats = purchased seats - active seats`

`unused monthly spend = unused seats × cost per seat`

A renewal review call can ask the owner whether to renew as-is, reduce seats, or cancel, then update the database with the result.

## Automation

`backend/automation.py` runs a background thread that checks every employee, customer, and license against real conditions and places the call itself — no button click involved. It uses the exact same `execute_call()` function the manual buttons use, so there is one code path for "a call gets placed" regardless of who asked for it.

| Rule | Condition (real, not seeded) |
| --- | --- |
| Employee check-in | Still marked `absent`, and the current wall-clock hour is past `CHECKIN_DEADLINE_HOUR` (default 10, matching the employee policy's 10:00 AM) |
| Employee offboarding | Flagged `Offboarding today` |
| Customer renewal | Flagged `Renewal due` / `At risk`, and `renewal_date` is within `RENEWAL_WINDOW_DAYS` (default 7) of today |
| License usage review | Utilization under 50% and `renewal_date` within the same window |
| License seat reclaim | Flagged `Reclaim needed` |

**Cross-pillar chain, fully autonomous:** an employee's offboarding call resolving no longer silently edits the license record. It flags the license `Reclaim needed` and logs that a confirmation call is pending. The *next* automation tick sees that flag and places a real `license:seat-reclaim` call to the department head; only that call's actual answer changes the seat count. Because each tick reads a fresh snapshot of the database, a chain like this typically resolves within one to two automation intervals — not always the same tick it started in.

Each rule only fires once per open condition: after a call resolves, the fields it changes (`attendance_status`, `flag`, `renewal_status`, `optimization_status`) no longer match the condition that triggered it, so it won't call the same person again until something actually changes. An `escalate` outcome is a real exception — Relay does not keep re-calling someone after a call has already been escalated; that's a human's job from there.

### Automated calls: disclosure, dedup, and how to stop them

This section exists because the destination repository's contribution guidelines specifically require every recurring workflow to disclose itself and explain how to cancel it.

- **Visible, not hidden.** The dashboard header shows an automation status bar on every page (interval, last check time, calls placed) — see `AutomationBar` in `frontend/src/main.jsx`. `GET /api/automation/status` and `POST /api/automation/run-once` expose the same thing over the API.
- **No duplicate jobs.** Firing is gated by each entity's own state (see table above) and an in-flight tracker for live calls still awaiting a result, so the same open condition can't place two calls at once.
- **To pause automation:** turn off "Automatic follow-ups" in Settings (`PATCH /api/settings {"automatic_followups": false}`), or turn off the specific pillar's toggle (`employee_operations`, `customer_lifecycle`, `vendor_optimization`).
- **To stop it entirely:** stop the Flask process — the loop is an in-process daemon thread with no external scheduler, no cron entry, and nothing that persists once the process exits.
- **No cancellation mid-call.** Once a real (non-dry-run) call is placed via CALL-E, there is no API to cancel it — it runs to completion. This is a property of CALL-E's API, not of this app, which is why dry-run is the default rather than an opt-in, and why the automation interval should be realistic in production (minutes/hours), not the short demo default.

Relevant env vars (`.env`):

```env
AUTOMATION_INTERVAL_SECONDS=20   # how often the engine checks; use minutes/hours in production
CHECKIN_DEADLINE_HOUR=10         # 24h clock, server local time
RENEWAL_WINDOW_DAYS=7
```

### Analytics
- Employee status breakdown
- Call completion rate
- Calls by pillar
- Monthly software spend
- Potential unused software spend
- Overall software utilization

### Call Log
Every call stores:
- Call ID
- Operational pillar
- Entity
- Action
- Status
- Summary
- Transcript
- Structured result
- Timestamp
- Dry-run/live mode

## Dummy data

Edit `data/seed.json` to change the demo company, employees, customers, software, meetings, memos, policies and settings.

Then regenerate the SQLite database:

```bash
python scripts/seed_db.py
```

The database is stored at:

```text
data/relay.db
```

The dummy people intentionally use non-Indian names.

## Run locally

### Backend

```bash
pip install -r requirements.txt
python -m backend.app
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown by the terminal.

## CALL-E

The demo runs in dry-run mode when no CALL-E API key is configured. This lets the entire product flow work locally: trigger call → simulated conversation → structured result → SQLite update → dashboard/call log update.

For live calls, configure `.env`:

```env
CALLE_API_KEY=your_key_here
CALLE_DRY_RUN=false
CALLE_BASE_URL=https://api.heycall-e.com
FLASK_PORT=5000
```

The Flask server keeps the CALL-E API key out of the React frontend.

## What changed in this pass

- Fixed a missing entry point — `python -m backend.app` previously imported cleanly and exited without ever starting a server.
- Fixed a real bug where **adding software, scheduling a meeting, and publishing a memo all failed** (`upsert_entity()` only accepted plural table names; every call site passed singular ones).
- Fixed the marketing policy being uploadable but never actually used by any call.
- Added `GET /api/calls/<id>`, so a real (non-dry-run) call has a way to ever report its outcome — previously it would sit at `status: queued` forever.
- Added the automation engine described above (`backend/automation.py`), including the dashboard's automation status bar and the fix to make the offboarding→seat-reclaim link a real confirmation call instead of a silent database edit.
- Removed a dead `server.js` left over from an earlier Node/Express iteration of this project.
- Masked phone numbers in the Employees and Customers views (`•••` + last 4 digits) — the repository's safety checklist explicitly asks for this.
- Expanded the seed data from 6 to 22 employees (8 departments) and grew customers/licenses to 9 each.

## Submitting to the CALL-E hackathon

This app is built for the `apps/python/<name>/` location in [`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents) — verified against that repository's actual `CONTRIBUTING.md` and its `scripts/validate_repository.py`, which passes with this app in place.

1. **Fork the repo** on GitHub (button, top right of the repo page) — this gives you `https://github.com/<your-username>/awesome-phone-call-agents`.
2. **Clone your fork and branch:**
   ```bash
   git clone https://github.com/<your-username>/awesome-phone-call-agents.git
   cd awesome-phone-call-agents
   python3 scripts/create_branch.py feat/relay-business-ops-agent
   ```
3. **Copy this project in:**
   ```bash
   mkdir -p apps/python/relay
   cp -r /path/to/this/project/* apps/python/relay/
   rm -rf apps/python/relay/frontend/node_modules apps/python/relay/data/relay.db apps/python/relay/frontend/dist
   ```
4. **Validate before opening anything:**
   ```bash
   python3 scripts/validate_repository.py
   ```
5. **Commit, push, open the PR:**
   ```bash
   git add apps/python/relay
   git commit -m "feat: add Relay, a business-operations agent for CALL-E"
   git push origin feat/relay-business-ops-agent
   ```
   Then open a pull request from your fork's branch into `CALLE-AI/awesome-phone-call-agents:main` (GitHub will prompt you to do this right after the push, or use `gh pr create` if you have the GitHub CLI).
6. **On the Devpost submission form:** paste the PR URL, your demo video link (YouTube/Vimeo, public, under 3 minutes), a text description of what Relay does, and the email tied to your CALL-E account.

