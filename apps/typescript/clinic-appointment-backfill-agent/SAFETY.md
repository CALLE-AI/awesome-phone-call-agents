# Safety & Compliance Reference

Phone-call workflows create real-world side effects. This document outlines safety boundaries for the Appointment Backfill Operator.

## Consent & Disclosure

### Patient Consent

**Before calling a waiting-list patient:**
- Patient must have **explicitly opted-in** to the waitlist
- Clinic should have **documented written consent** for backfill calls
- Patient should know they may be called for available slots
- Consent form should mention **AI voice** and **automated call**

**Recommended consent language:**
> *"We may call you at [phone] when an appointment slot opens in your preferred department. The call will be made by AI on behalf of Dr. [Name]. You can decline the offer or ask us to stop calling."*

### Disclosure on Call

The CALL-E call script should disclose:
- **Who is calling** — "[Clinic name] calling about your appointment"
- **Why they're calling** — "We have an open slot in Cardiology"
- **What will happen** — "I'll ask if you can make this time"
- **That it's AI** — "This is an automated call from our scheduling system"

## Phone Number Handling

### Data Storage

- **Full phone numbers** are stored in the database (column: `phone_number`)
- **Full phone numbers** are sent to CALL-E API for call execution
- Numbers must be in **strict E.164 format**: `+1234567890` (country code + digits)

### Data Display

- **Masked in UI** — Phone numbers displayed as `*****7890` (last 4 digits only)
- **Masked in logs** — Console output masks as `+1***5678`
- **Unmasked in database** — Full numbers stored for compliance records
- **Unmasked in CALL-E** — Full numbers sent to API (required for call)

**Why separate display/storage?**
- UI is visible to front-desk staff → masked for privacy
- Database is compliance record → needs full number for audit
- CALL-E needs full number → required for actual phone call

### Phone Number Validation

All incoming phone numbers must:
1. Be in E.164 format (starts with `+`, country code, digits only)
2. Match regex: `^\+[1-9]\d{1,14}$`
3. Pass a format check before any call is placed

```typescript
// Example validation
const isE164 = /^\+[1-9]\d{1,14}$/.test(phoneNumber);
if (!isE164) throw new Error('Invalid E.164 format');
```

## Cancellation Handling

### Immutable Cancellation Record

Once an appointment is marked `CANCELLED`:
- Status **cannot be changed** back to BOOKED
- This prevents accidental re-booking
- Audit trail shows who cancelled and when
- Use database constraints to enforce

```typescript
// Schema constraint (Prisma)
model Appointment {
  status String @default("BOOKED")  // BOOKED or CANCELLED only
}
```

### Cancellation Audit Trail

Every cancellation must log:
- **Who** — Which user/system cancelled
- **When** — Exact timestamp
- **Reason** — Why (e.g., "Patient request", "No-show", "Schedule conflict")
- **Before/After** — Previous status, new status

```typescript
// Example audit entry
{
  appointment_id: "uuid-123",
  action: "CANCEL",
  timestamp: "2026-09-02T15:30:00Z",
  reason: "Patient called to cancel",
  triggered_by: "inbound-call",
  backfill_status: "triggered"
}
```

## Call Idempotency

### The Problem

If a webhook is replayed or a network error retries, the same patient could be called twice:
- Webhook received but response times out
- System retries the webhook
- Patient gets two calls (bad experience)

### Solution: Idempotent Keys

1. **Derive key from authorization, not attempt**
   - Good: `idempotency_key = hash(appointment_id + patient_id + timestamp_hour)`
   - Bad: `idempotency_key = hash(attempt_number)` ← Can change on retry

2. **Reserve slot before calling**
   - Mark `call_in_progress = true` before CALL-E call
   - If call times out, don't retry the same slot
   - Cascade to next patient instead

3. **Webhook deduplication**
   - Store `calle_call_id` before processing result
   - Check if call already logged
   - If duplicate, return success (already processed)

```typescript
// Deduplicate incoming webhooks
const existingCall = await prisma.callLog.findUnique({
  where: { calle_call_id: webhook.call_id }
});
if (existingCall) {
  return { ok: true, cached: true };  // Already processed
}

// Otherwise, log the new call
await prisma.callLog.create({
  data: {
    calle_call_id: webhook.call_id,
    direction: "OUTBOUND",
    patient_id: webhook.patient_id,
    status: webhook.status,
    transcript_summary: webhook.transcript
  }
});
```

## Call Cascade Ordering

### Sequential Ordering (No Parallel Calling)

**Rule:** Never call multiple waiting patients in parallel for the same slot.

**Why?** Two patients could both accept, causing double-booking.

**Implementation:**

```typescript
// Call patients one-at-a-time
const waitlist = await prisma.waitlist.findMany({
  where: { status: "WAITING" },
  orderBy: [{ priority_score: "desc" }, { created_at: "asc" }],
  include: { patient: true }
});

for (const entry of waitlist) {
  const result = await calle.call(entry.patient);
  
  if (result.accepted) {
    // Stop cascade — first acceptance wins
    await prisma.waitlist.update({
      where: { id: entry.id },
      data: { status: "MATCHED" }
    });
    break;  // Exit loop — do not call next patient
  }
  
  // result.declined or result.no_answer → continue loop
}
```

### Stopping at First Acceptance

- As soon as one patient accepts the slot, **stop calling**
- Mark that patient's waitlist entry as `MATCHED`
- Do not call any remaining patients
- Return confirmation to clinic staff

## Call Failure Modes

### Ambiguous Outcomes

**Distinguish between:**

| Outcome | Meaning | Action |
|---------|---------|--------|
| `COMPLETED` | Call answered, patient responded | Process result |
| `NO_ANSWER` | Phone rang, no one answered | Try next patient |
| `FAILED` | Number invalid, line unreachable | Try next patient |
| `DECLINED` | Patient explicitly said no | Try next patient |
| `TIMEOUT` | Call took too long to connect | **Stop cascade** |

**Timeout is not a retry signal** — if CALL-E times out, stop and alert clinic staff to review.

```typescript
if (result.status === "TIMEOUT") {
  console.error("Call timed out. Stopping cascade.");
  await notifyClinicStaff("Backfill timeout", { reason: "Call did not complete" });
  break;  // Stop cascade
}
```

### Error Handling

- **Network errors** → Don't retry immediately; use exponential backoff
- **Invalid phone** → Log error and skip patient
- **API unreachable** → Return error to dashboard; don't auto-retry
- **Unknown outcome** → Route to human for manual review

## Recording & Transcripts

### Recording Disclaimer

Clinic must comply with **one-party consent** or **two-party consent** laws:

- **One-party states** (USA: CA, FL, IL, MD, PA, etc.) — Clinic records without telling patient
- **Two-party states** (USA: others) — Must disclose at start of call: *"This call may be recorded"*

Check your jurisdiction before enabling recording.

### Transcript Privacy

- Store transcripts in encrypted database
- Mask PII in display (names, addresses, SSN)
- Retain transcripts only as long as legally required
- Provide patient access on request (data subject rights)
- Delete after retention window (e.g., 30 days, 1 year)

## Rate Limiting

### Call Frequency Limits

Prevent **call fatigue** by limiting how often a patient is called:

- **Max 1 call per patient per 24 hours** for waitlist offers
- **Max 3 calls per patient per week** for any reason
- **Skip patients who declined within last 7 days**

```typescript
// Before calling, check recent history
const recentDecline = await prisma.callLog.findFirst({
  where: {
    patient_id: patientId,
    direction: "OUTBOUND",
    status: "DECLINED",
    created_at: { gte: 7.daysAgo }
  }
});

if (recentDecline) {
  return; // Skip this patient
}
```

## Quiet Hours

### Do Not Call Windows

- **During off-hours** — Set quiet hours (e.g., 9 PM–7 AM)
- **On weekends** — Consider skipping Saturday/Sunday
- **On holidays** — Do not call on major holidays
- **At patient request** — Honor opt-out preferences

```typescript
function isInQuietHours(now: Date): boolean {
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  
  // No calls between 21:00 (9 PM) and 07:00 (7 AM)
  if (hour >= 21 || hour < 7) return true;
  
  // No calls on Sunday (0) or Saturday (6)
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  
  return false;
}

if (isInQuietHours(new Date())) {
  console.log("Quiet hours active. Deferring calls.");
  return;
}
```

## Data Retention

### How Long to Keep Data

| Data Type | Retention Period | Reason |
|-----------|------------------|--------|
| Call transcripts | 30–90 days | Compliance, dispute resolution |
| Structured results | 1 year | Audit trail, analytics |
| Patient contact info | As long as patient active | Operational records |
| Declined/no-answer logs | 7 days | Do not call frequency checks |
| Cancelled appointments | Permanent | Immutable audit trail |

### Deletion Policy

After retention window:
1. Delete personal data (names, phone, email)
2. Keep anonymized results (e.g., "1 call ACCEPTED")
3. Ensure backups also delete old data
4. Provide audit certificate of deletion

## Testing with Real Data

### Safeguards for Live Calls

Before using real CALL-E credits:

1. **Test with allowed numbers only**
   - Set `ALLOWED_RECIPIENTS` environment variable
   - Only call clinic staff or test numbers (e.g., +1-555-0100)
   - Never test with patient numbers

2. **Use dry-run first**
   - Run all code paths with `ALLOW_LIVE_CALLS=false`
   - Verify database, logic, formatting
   - Only enable `ALLOW_LIVE_CALLS=true` when confident

3. **Get human approval**
   - Have clinic manager review call script
   - Get written sign-off before first patient call
   - Log approver name and timestamp

4. **Monitor real calls**
   - Watch live call activity in dashboard
   - Alert clinic staff on first few calls
   - Check patient feedback for issues

## HIPAA Compliance (if in USA)

### Data Security

- **Encrypt at rest** — Use AES-256 for database encryption
- **Encrypt in transit** — Use TLS 1.2+ for all API calls
- **Access controls** — Log who accesses patient data
- **Audit logs** — Keep immutable records of all PHI access

### Business Associate Agreement (BAA)

If using a vendor (e.g., CALL-E), ensure:
- Vendor signed Business Associate Agreement
- Vendor commits to HIPAA compliance
- Incident notification clause included
- Subprocessor list provided

### Patient Rights

- **Right to access** — Patients can request their records
- **Right to amend** — Patients can correct their info
- **Right to delete** — Some jurisdictions allow deletion requests
- **Right to opt-out** — Patients can decline future calls

## Escalation & Human Review

### When to Stop & Alert Clinic

Stop the cascade and notify clinic staff if:
- ❌ Call outcome is ambiguous or unknown
- ❌ Patient explicitly requests to stop calling
- ❌ CALL-E API is unreachable (more than 2 retries)
- ❌ More than 3 patients decline in a row
- ❌ Call results seem suspicious or unusual

```typescript
if (declineCount >= 3) {
  console.error("Too many declines. Stopping cascade.");
  await notifyClinicStaff("Backfill stopped", {
    reason: "Multiple patient declines",
    declineCount: 3
  });
  return;
}
```

### Manual Override

Clinic staff should always have ability to:
1. **Cancel a call** in progress
2. **Pause backfill** temporarily
3. **Override priority** (call a specific patient)
4. **View all call evidence** (transcript, audio, structured result)

## Regional Compliance

### United States

- **HIPAA** (health data privacy)
- **TCPA** (Telephone Consumer Protection Act — no robocalls without consent)
- **State consent laws** — CA, IL, PA, etc. require consent to record

### European Union

- **GDPR** (data protection, right to erasure)
- **ePrivacy Directive** (consent before calling)
- **GDPR Article 21** (right to object to processing)

### Canada

- **PIPEDA** (Personal Information Protection Act)
- **CASL** (Anti-Spam Legislation — consent required before calling)

### Australia

- **Privacy Act** (Australian Privacy Principles)
- **Spam Act** (Do Not Call register)

## Incident Response

### If Something Goes Wrong

1. **Stop immediately** — Pause all outbound calls
2. **Investigate** — Check logs, identify root cause
3. **Notify affected patients** — If data breach, notify per regulations
4. **Document** — Record what happened and how you fixed it
5. **Review** — Update safety gates to prevent recurrence
6. **Improve** — Make the breach impossible next time

### Breach Notification Timeline

- **Discovered** → Stop calls immediately
- **Within 24 hours** → Internal review
- **Within 72 hours** → Notify authorities (if required by law)
- **Without unreasonable delay** → Notify affected individuals

## References

- [HIPAA Guidance](https://www.hhs.gov/hipaa/index.html)
- [TCPA Rules (FCC)](https://www.fcc.gov/consumers/guides/telemarketing-and-robocalls)
- [GDPR Compliance](https://gdpr-info.eu/)
- [Call-E Safety Docs](https://docs.call-e.ai/safety)
- [Production Workflow Guide](../../../docs/production-workflows.md)

## Checklist for Production

- [ ] Written consent obtained from all patients
- [ ] Phone numbers validated in E.164 format
- [ ] Cancellation audit trail enabled
- [ ] Idempotent call handling implemented
- [ ] Sequential cascade (no parallel calls)
- [ ] Quiet hours configured
- [ ] Rate limiting (1 call/patient/24h) enforced
- [ ] Call recording disclosure configured
- [ ] Transcript retention policy documented
- [ ] HIPAA BAA signed (if applicable)
- [ ] Breach notification plan written
- [ ] Regional compliance reviewed (HIPAA, GDPR, CASL, etc.)
- [ ] Clinic staff trained on tool usage
- [ ] Monitoring/alerting set up
- [ ] Human review process for edge cases
- [ ] Data encryption at rest & in transit
- [ ] Access logs and audit trail active
