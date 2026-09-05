# Setup & Usage Guide

## Prerequisites

- Node.js 18+
- CALL-E API key (20 free calls with new account at https://call-e.ai)
- SQLite 3 (included with Node.js)
- Git

## Installation

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/YOUR-USERNAME/awesome-phone-call-agents.git
cd awesome-phone-call-agents/apps/typescript/appointment-backfill-operator
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
DATABASE_URL="file:./dev.db"
CALLE_BASE_URL="https://api.heycall-e.com"
CALLE_API_KEY="iams_live_YOUR_KEY_HERE"    # Get from https://call-e.ai
PORT=3000
ALLOW_LIVE_CALLS=true                      # false for dry-run mode
```

### 3. Initialize Database

```bash
npx prisma migrate dev --name init
```

This creates the SQLite database and tables based on the schema.

### 4. Seed Demo Data

```bash
npm run prisma:seed
```

Creates:
- **5 booked patients** (Aarav, Priya, Rohan, Meera, Kabir) with scheduled appointments
- **3 waitlist patients** (Ananya, Rahul, Sneha) waiting for an available slot
- **5 appointments** scheduled 2, 5, 7, 10, 12 days from now
- **3 waitlist entries** with priority scores (95, 80, 70)

The seeded phone numbers are fictional placeholders in E.164 format. For live testing, replace them in `src/seed.ts` and `prisma/seed.ts` with numbers whose owners have consented to receive calls. Keep `ALLOW_LIVE_CALLS=false` for demos.

### 5. Start Server

```bash
npm run dev
```

Server runs on `http://localhost:3000`

## Usage

### Dashboard

Open: **http://localhost:3000/dashboard**

#### Statistics Cards
- **Booked** — Active appointments
- **Cancelled** — Cancelled appointments
- **Waiting** — Patients on waitlist
- **Patients** — Total patient count

#### Mock Hospital Intake Form
1. Select a patient from "Patient" dropdown
2. Select an appointment from "Appointment slot" dropdown (filtered to that patient)
3. Enter cancellation reason (e.g., "Schedule conflict")
4. Click **"Simulate inbound cancellation"** to mark appointment as cancelled

#### Waitlist Priority Queue
Shows all waiting patients with:
- **Patient name**
- **Preferred department**
- **Priority score** (higher = called first)
- **Status** (WAITING/MATCHED)
- **Phone** (masked for privacy)

#### Clinic Schedule
All appointments with:
- **When** — Scheduled date/time
- **Patient** — Patient name
- **Provider** — Doctor name
- **Department** — Specialty
- **Status** — BOOKED/CANCELLED
- **Action** — Cancel button (if not already cancelled)

#### Live Outbound Monitor
Recent CALL-E activity:
- Direction (INBOUND/OUTBOUND)
- Call status (COMPLETED/FAILED/NO_ANSWER)
- Transcript summary

### Trigger Backfill

```bash
# From dashboard: Click "Trigger outbound backfill"
# The app will:
# 1. Fetch all WAITING patients ordered by priority_score DESC
# 2. Call each patient sequentially via CALL-E
# 3. Stop at the first acceptance
# 4. Return structured result (ACCEPTED/DECLINED/NO_ANSWER)
```

### Reset Demo Data

Click **"Reset demo data"** to:
- Delete all call logs
- Delete all waitlist entries
- Delete all appointments
- Delete all patients
- Re-seed with fresh data

Useful for replaying the demo.

## API Endpoints

### GET /api/dashboard/stats

Fetch all statistics for the dashboard.

**Response:**
```json
{
  "booked": 4,
  "cancelled": 1,
  "waiting": 3,
  "totalPatients": 8,
  "patients": [
    {"id": "uuid", "first_name": "Aarav", "last_name": "Sharma", "phone_number": "+15555550101", "label": "Aarav Sharma"}
  ],
  "appointments": [
    {"id": "uuid", "scheduled_at": "2026-09-04T00:00:00.000Z", "provider_name": "Dr. Emily Smith", "department": "Cardiology", "status": "BOOKED", "patient": "Aarav Sharma", "patient_id": "uuid"}
  ],
  "queue": [
    {"id": "uuid", "patient": "Ananya Verma", "priority_score": 95, "preferred_department": "Cardiology", "status": "WAITING", "phone_number": "+15555550106"}
  ],
  "recent_calls": [
    {"id": "uuid", "patient": "Ananya Verma", "direction": "OUTBOUND", "status": "COMPLETED", "transcript_summary": "Patient accepted the appointment offer."}
  ]
}
```

### POST /api/appointments/cancel

Cancel an appointment and trigger backfill.

**Request:**
```json
{
  "appointment_id": "uuid",
  "action": "CANCEL",
  "reason": "Cancelled from hospital dashboard"
}
```

**Response:**
```json
{
  "ok": true,
  "appointment_id": "uuid",
  "action": "CANCEL",
  "reason": "Cancelled from hospital dashboard"
}
```

### POST /api/inbound/mock

Simulate an inbound cancellation call (for testing).

**Request:**
```json
{
  "appointment_id": "uuid",
  "patient_id": "uuid",
  "action": "CANCEL",
  "reason": "Patient reported schedule conflict"
}
```

**Response:**
```json
{
  "ok": true,
  "appointment_id": "uuid",
  "action": "CANCEL",
  "reason": "Patient reported schedule conflict"
}
```

### POST /api/appointments/reset-demo

Reset database to seeded state.

**Response:**
```json
{
  "ok": true,
  "message": "Demo data reset and reseeded"
}
```

## Database Management

### View Database with Prisma Studio

```bash
npx prisma studio
```

Opens **http://localhost:5555** with a GUI for browsing and editing data.

### Query Database Directly

```bash
# List all patients
sqlite3 dev.db "SELECT * FROM Patient;"

# List all appointments
sqlite3 dev.db "SELECT * FROM Appointment;"

# List all call logs
sqlite3 dev.db "SELECT * FROM CallLog;"

# List all waitlist entries
sqlite3 dev.db "SELECT * FROM Waitlist;"
```

### Reset Database

```bash
# Delete database file (next server start will recreate)
rm dev.db

# Re-run migrations
npx prisma migrate dev --name init

# Re-seed
npm run prisma:seed
```

## Testing & Development

### Dry-Run Mode (No Real Calls)

```bash
ALLOW_LIVE_CALLS=false npm run dev
```

Calls are logged but not executed. Useful for testing without consuming CALL-E credits.

### View Logs

```bash
# Start server with verbose logging
DEBUG=* npm run dev

# Or check SQLite logs
sqlite3 dev.db "SELECT direction, status, transcript_summary FROM CallLog ORDER BY created_at DESC LIMIT 10;"
```

### Manual API Testing

```bash
# Health check
curl http://localhost:3000/health

# Get stats
curl http://localhost:3000/api/dashboard/stats

# Cancel an appointment (replace UUIDs)
curl -X POST http://localhost:3000/api/appointments/cancel \
  -H "Content-Type: application/json" \
  -d '{
    "appointment_id": "UUID_HERE",
    "action": "CANCEL",
    "reason": "Test cancellation"
  }'

# Reset demo
curl -X POST http://localhost:3000/api/appointments/reset-demo \
  -H "Content-Type: application/json"
```

## Troubleshooting

### CALL-E API Key Not Working

Confirm that `CALLE_API_KEY` is present in `.env`, has not been committed, and that `CALLE_BASE_URL` points to the expected CALL-E environment. Use `ALLOW_LIVE_CALLS=false` while diagnosing configuration.

### Database Migration Failed

```bash
# Check Prisma schema
npx prisma validate

# Reset and re-migrate
rm dev.db
npx prisma migrate dev --name init
npm run prisma:seed
```

### Port Already in Use

```bash
# Change port
PORT=3001 npm run dev

# Or kill the process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows
```

### No Patients in Dropdown

```bash
# Check if seeding worked
sqlite3 dev.db "SELECT COUNT(*) FROM Patient;"

# If empty, re-seed
npm run prisma:seed
```

## Next Steps

1. **Try the demo flow** — Cancel an appointment, trigger backfill, watch waitlist patients get called
2. **Inspect call logs** — Use Prisma Studio to see what CALL-E returned
3. **Test with real calls** — Set `ALLOW_LIVE_CALLS=true` and use your 20 free CALL-E credits
4. **Integrate with your EHR** — Connect to Epic, Cerner, or your clinic's system
5. **Add real inbound** — Replace mock webhook with Twilio, CallKit, or your provider
6. **Deploy to production** — Use persistent job queue, secrets vault, and monitoring

## Documentation

- [README.md](README.md) — Project overview
- [SAFETY.md](SAFETY.md) — Compliance and safety notes
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — How to contribute
- [CALL-E Docs](https://docs.call-e.ai) — CALL-E API reference

## Support

- **Issues**: https://github.com/CALLE-AI/awesome-phone-call-agents/issues
- **Discord**: https://discord.gg/6AbXUzUV8w
- **Discussions**: https://github.com/CALLE-AI/awesome-phone-call-agents/discussions
