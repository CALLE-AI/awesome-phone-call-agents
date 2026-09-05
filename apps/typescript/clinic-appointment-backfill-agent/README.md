# Appointment Backfill Operator

Clinic-side appointment recovery via CALL-E: when a patient cancels, automatically calls waiting-list patients in priority order to fill the open slot—with explicit human approval gates, transcript evidence storage, masked phone numbers for HIPAA compliance, and a live operations dashboard.

## Problem & Solution

Open appointment slots cost clinics revenue and hurt patient care access. Manual backfill—calling patients from a waitlist one-by-one—is slow, error-prone, and falls through cracks during busy hours. This app automates the entire sequence:

1. **Cancellation detected** → appointment marked `CANCELLED`
2. **Backfill triggered** → fetches highest-priority waiting patients
3. **Sequential calls** → CALL-E dials each patient with the open slot offer
4. **Cascade stops** at first acceptance → schedules the match
5. **Evidence stored** → all calls logged with transcripts and outcomes
6. **Zero double-books** → strict ordering prevents overbooking

## Features

✅ **Outbound backfill orchestration** — CALL-E calls waiting-list patients in priority order  
✅ **Inbound cancellation detection** — mock webhooks or dashboard-triggered cancellations  
✅ **Live dashboard** — real-time stats, waitlist queue, appointment schedule, call activity  
✅ **Structured call results** — accepts/declines/no-answer with durable evidence  
✅ **Idempotent calls** — no duplicate calls on retry or webhook replay  
✅ **HIPAA-ready** — masked phone numbers in UI, full encryption option for database  
✅ **Transcript audit trail** — every call stored with direction, status, and structured output  
✅ **Reset demo data** — safe local testing with seeded patients and appointments  

## Quick Start

See [USAGE.md](USAGE.md) for full setup.

The seed files use fictional `+1555555...` phone numbers as placeholders. Replace them with consented, reachable E.164 numbers before enabling live calls; keep `ALLOW_LIVE_CALLS=false` for local demos.

```bash
npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev

# Open http://localhost:3000/dashboard
```

## How It Works

### Architecture

```
Dashboard (HTML/JS)
  ↓ HTTP REST
Express Server
  ↓
BackfillOrchestrator
  ├─ Fetch high-priority waiting patients
  ├─ Call each sequentially via CALL-E
  └─ Stop at first acceptance
       ↓
CALL-E API (v1)
  ├─ POST /v1/calls → create task
  └─ GET /v1/calls/{id} → poll status
       ↓
Prisma + SQLite
  ├─ Patients, Appointments, Waitlist
  └─ CallLog (evidence storage)
```

### Demo Flow

1. **View Dashboard** → See 5 booked appointments, 3 waiting-list patients
2. **Simulate Cancellation** → Select patient + appointment, click submit
3. **Appointment Cancelled** → Status changes to `CANCELLED`
4. **Trigger Backfill** → Click "Trigger outbound backfill"
5. **CALL-E Calls Waitlist** → First patient accepts → slot filled
6. **View Transcript** → Check "Live outbound monitor" for evidence
7. **Reset** → Click "Reset demo data" to replay

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/dashboard/stats` | Fetch stats: booked, waiting, patients, appointments, queue, recent calls |
| `POST` | `/api/appointments/cancel` | Cancel appointment & trigger backfill |
| `POST` | `/api/inbound/mock` | Simulate inbound cancellation call |
| `POST` | `/api/appointments/reset-demo` | Reset to seeded data |
| `GET` | `/dashboard` | HTML dashboard UI |

## Safety & Compliance

See [SAFETY.md](SAFETY.md) for detailed compliance notes.

**Key safeguards:**
- ✅ Phone numbers **masked in UI only** (full numbers in database & CALL-E API)
- ✅ Explicit **backfill approval** shown on dashboard (not automatic)
- ✅ **Immutable cancellation audit** — once marked CANCELLED, cannot be undone
- ✅ **Idempotent calls** — duplicate webhook replays don't create duplicate calls
- ✅ **Evidence-first** — all calls logged with transcripts before and after dispatch
- ✅ **Sequential cascade** — no parallel calling, prevents race-condition double-books

## Project Structure

```
src/
├── index.ts                    # Express server & routes setup
├── prismaClient.ts            # Prisma client singleton
├── seed.ts                     # Database seeder (patients, appointments, waitlist)
├── public/
│   └── dashboard.html         # Real-time SPA dashboard
├── routes/
│   ├── appointments.ts        # POST /cancel, /reset-demo
│   ├── dashboard.ts           # GET /stats
│   ├── inbound.ts             # Mock inbound webhooks
│   └── webhooks.ts            # Real CALL-E webhooks (future)
└── services/
    ├── CalleService.ts        # CALL-E API wrapper
    └── BackfillOrchestrator.ts # Cascade orchestration logic

prisma/
├── schema.prisma              # Data models
└── seed.ts                     # Executable seeder

```

The dashboard and documented API endpoints provide the supported demo and inspection flows; no standalone helper scripts are required.

## Database Schema

**Patient**
```typescript
id: String (UUID)
first_name: String
last_name: String
phone_number: String (E.164)
date_of_birth: DateTime
email: String?
appointments: Appointment[]
waitlist: Waitlist[]
call_logs: CallLog[]
```

**Appointment**
```typescript
id: String (UUID)
patient_id: String
provider_name: String
department: String
scheduled_at: DateTime
status: String ("BOOKED", "CANCELLED")
is_backfill_eligible: Boolean
created_at: DateTime
```

**Waitlist**
```typescript
id: String (UUID)
patient_id: String
preferred_department: String
target_provider: String?
priority_score: Int
status: String ("WAITING", "MATCHED")
created_at: DateTime
```

**CallLog**
```typescript
id: String (UUID)
calle_call_id: String
direction: String ("INBOUND", "OUTBOUND")
patient_id: String
status: String
transcript_summary: String?
structured_output: String? (JSON)
created_at: DateTime
```

## Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# CALL-E Configuration
CALLE_BASE_URL="https://api.heycall-e.com"
CALLE_API_KEY="iams_live_..."  # Get from https://call-e.ai
PORT=3000

# Call Behavior
ALLOW_LIVE_CALLS=true           # Set to false for mock mode

# Optional: Twilio (for future inbound calls)
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_FROM_NUMBER="+1..."
```

## Dry-Run & Preview

**No real calls are placed until:**
1. A patient cancels an appointment
2. Backfill is manually triggered on dashboard
3. `ALLOW_LIVE_CALLS=true` in `.env`

**To test without CALL-E:**
```bash
ALLOW_LIVE_CALLS=false npm run dev
# Calls will be logged but not executed
```

## Known Limitations

1. **Stateless backfill** — Cascade resets on server restart. Use persistent job queue (Bull, AWS SQS) in production.
2. **No EHR integration** — Appointments managed manually. Real clinics should connect to Epic, Cerner, or eClinicalWorks.
3. **Mock inbound only** — Real inbound calls use Twilio/CallKit; currently using simulated endpoint.
4. **UI polling** — Dashboard refreshes every 8 seconds. Upgrade to WebSocket for real-time updates.
5. **No rate limiting** — Consider 1 call/patient/24h limit for production.

## Production Readiness

For production deployment, add:

- [ ] Real EHR integration (appointment sync)
- [ ] Real inbound call provider (Twilio, Vonage, CallKit)
- [ ] Persistent job queue (Bull, AWS SQS, RabbitMQ)
- [ ] Secrets vault (AWS Secrets Manager, HashiCorp Vault)
- [ ] Rate limiting & backoff strategy
- [ ] Call failure alerting (Slack, PagerDuty, Splunk)
- [ ] HIPAA BAA compliance audit
- [ ] Encrypted database (at-rest + in-transit)
- [ ] WebSocket for live dashboard updates
- [ ] Comprehensive audit logging (who, what, when, why)

## Testing

```bash
# Install dependencies
npm install

# Run migrations
npx prisma migrate dev --name init

# Seed demo data
npm run prisma:seed

# Start server
npm run dev

# View database with Prisma Studio
npx prisma studio

# Query call logs
sqlite3 dev.db "SELECT * FROM CallLog;"
```

## Key CALL-E Integration Points

1. **Call Creation**: `CalleService.createAndWait()` — submits outbound call task
2. **Status Polling**: Polls every 5s until `completed`, `failed`, `no_answer`, or `cancelled`
3. **Result Extraction**: Parses call status → structured result (accepted/declined/no-answer)
4. **Metadata Tracking**: Passes appointment ID, patient ID, priority for downstream routing
5. **Error Resilience**: Graceful fallback if CALL-E API unreachable

## Contributing

Improvements welcome. See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines.

Examples:
- Real inbound call provider integration
- Google Calendar sync for availability
- Multi-department intelligent routing
- Patient feedback collection post-call
- A/B test different scripts
- Export audit reports (PDF/CSV)

## License

MIT. See [LICENSE](../../../LICENSE).

## Contact & Support

- **CALL-E Discord**: https://discord.gg/6AbXUzUV8w
- **Issues**: https://github.com/CALLE-AI/awesome-phone-call-agents/issues
- **Discussions**: https://github.com/CALLE-AI/awesome-phone-call-agents/discussions

---

**Disclaimer**: Phone calls have real-world consequences. Always:
- ✅ Test with mock calls first
- ✅ Get explicit written consent before calling patients
- ✅ Follow HIPAA, GDPR, and local healthcare regulations
- ✅ Have a human review high-risk call scripts
- ✅ Monitor all outbound activity in real-time
- ✅ Keep detailed audit logs for compliance review
http://localhost:3000/dashboard
```

## Key endpoints

- `POST /api/appointments/cancel`
- `POST /api/webhooks/calle`
- `POST /api/inbound/mock`
- `GET /api/dashboard/stats`

## Notes

This project includes a mock CALL-E implementation and a clean extension point for real CALL-E API calls via the `CalleService` wrapper.
