# Examples

These examples show how to use `capacity-backfill-cascade` for booking confirmation and waitlist cascade workflows.

All phone numbers use reserved fictional E.164 numbers (+155501xx, +155502xx).

## Example: Restaurant Backfill

Scenario: A restaurant with 10 bookings for tonight and 5 waitlisted parties wants to confirm reservations and backfill any cancellations.

### Input: reservations.jsonl

```json
{"booking_id": "R-001", "name": "Fictional Guest One", "phone": "+15550101", "party_size": 4, "slot": "2026-09-10T19:00:00+07:00", "consent": true, "status": "PENDING_CONFIRM"}
{"booking_id": "R-002", "name": "Fictional Guest Two", "phone": "+15550102", "party_size": 2, "slot": "2026-09-10T19:00:00+07:00", "consent": true, "status": "PENDING_CONFIRM"}
{"booking_id": "R-003", "name": "Fictional Guest Three", "phone": "+15550103", "party_size": 6, "slot": "2026-09-10T19:30:00+07:00", "consent": true, "status": "PENDING_CONFIRM"}
{"booking_id": "R-004", "name": "Fictional Guest Four", "phone": "+15550104", "party_size": 3, "slot": "2026-09-10T20:00:00+07:00", "consent": false, "status": "PENDING_CONFIRM"}
```

### Input: waitlist.jsonl

```json
{"entry_id": "W-001", "name": "Fictional Waitlist One", "phone": "+15550201", "party_size": 4, "window_start": "2026-09-10T18:00:00+07:00", "window_end": "2026-09-10T21:00:00+07:00", "priority": 1, "consent": true, "status": "WAITING"}
{"entry_id": "W-002", "name": "Fictional Waitlist Two", "phone": "+15550202", "party_size": 2, "window_start": "2026-09-10T18:00:00+07:00", "window_end": "2026-09-10T21:00:00+07:00", "priority": 2, "consent": true, "status": "WAITING"}
{"entry_id": "W-003", "name": "Fictional Waitlist Three", "phone": "+15550203", "party_size": 8, "window_start": "2026-09-10T18:00:00+07:00", "window_end": "2026-09-10T21:00:00+07:00", "priority": 3, "consent": true, "status": "WAITING"}
```

### Dry-run Execution

```bash
python skills/capacity-backfill-cascade/scripts/run_cascade.py \
  --data-dir skills/capacity-backfill-cascade/assets \
  --state-dir /tmp/cascade-state
```

Expected dry-run output:
```
Dry-run mode: no calls will be placed
Phase: confirm
  Would dial R-001: +1****0101 (consent: true, status: PENDING_CONFIRM)
  Would dial R-002: +1****0102 (consent: true, status: PENDING_CONFIRM)
  Would dial R-003: +1****0103 (consent: true, status: PENDING_CONFIRM)
  Skip R-004: +1****0104 (consent: false)
Phase: cascade (no cancelled slots yet)
Total calls: 3 (confirm: 3, cascade: 0)
```

### Live Execution with Budget

```bash
python skills/capacity-backfill-cascade/scripts/run_cascade.py \
  --data-dir skills/capacity-backfill-cascade/assets \
  --state-dir /tmp/cascade-state \
  --live \
  --max-calls 6
```

### Expected Audit Trail (audit.jsonl)

```json
{"timestamp": "2026-09-10T17:00:00+07:00", "run_id": "run-001", "phase": "confirm", "booking_id": "R-001", "decision": "DIAL", "reason": "consent=true, status=PENDING_CONFIRM"}
{"timestamp": "2026-09-10T17:05:00+07:00", "run_id": "run-001", "phase": "confirm", "booking_id": "R-001", "decision": "OUTCOME", "outcome": "CONFIRMED", "phone": "+1****0101"}
{"timestamp": "2026-09-10T17:10:00+07:00", "run_id": "run-001", "phase": "confirm", "booking_id": "R-002", "decision": "DIAL", "reason": "consent=true, status=PENDING_CONFIRM"}
{"timestamp": "2026-09-10T17:15:00+07:00", "run_id": "run-001", "phase": "confirm", "booking_id": "R-002", "decision": "OUTCOME", "outcome": "CANCELLED", "phone": "+1****0102"}
{"timestamp": "2026-09-10T17:16:00+07:00", "run_id": "run-001", "phase": "cascade", "entry_id": "W-001", "decision": "DIAL", "reason": "match slot, consent=true, priority=1"}
{"timestamp": "2026-09-10T17:20:00+07:00", "run_id": "run-001", "phase": "cascade", "entry_id": "W-001", "decision": "OUTCOME", "outcome": "ACCEPTED", "phone": "+1****0201", "slot_recovered": "R-002"}
{"timestamp": "2026-09-10T17:20:00+07:00", "run_id": "run-001", "phase": "cascade", "entry_id": "W-002", "decision": "SKIP", "reason": "slot already recovered"}
{"timestamp": "2026-09-10T17:00:00+07:00", "run_id": "run-001", "phase": "confirm", "booking_id": "R-004", "decision": "SKIP", "reason": "consent=false", "audit": "SKIPPED_NO_CONSENT"}
```

### Expected Staff Report (report.md)

```markdown
# Cascade Run Report: run-001
Date: 2026-09-10T17:00:00+07:00

## Summary
- Confirm calls: 3 placed, 2 completed (CONFIRMED: 1, CANCELLED: 1), 1 pending
- Cascade calls: 1 placed, 1 completed (ACCEPTED: 1)
- Slots recovered: 1 (R-002)
- Waitlist contacted: 1 (W-001)
- No answers: 0
- Errors: 0

## Confirm Results
| Booking | Guest | Phone | Outcome |
|---------|-------|-------|---------|
| R-001 | Fictional Guest One | +1****0101 | CONFIRMED |
| R-002 | Fictional Guest Two | +1****0102 | CANCELLED |
| R-003 | Fictional Guest Three | +1****0103 | NO_ANSWER |

## Cascade Results
| Slot Recovered | Waitlist Entry | Guest | Phone | Outcome |
|----------------|----------------|-------|-------|---------|
| R-002 | W-001 | Fictional Waitlist One | +1****0201 | ACCEPTED |

## Escalation Required
The following targets require manual follow-up:
- R-003 (+1****0103): NO_ANSWER after retries
```

## Example: Consent Handling

### Input with Missing Consent

```json
{"booking_id": "R-005", "name": "Fictional Guest Five", "phone": "+15550105", "party_size": 4, "slot": "2026-09-10T19:00:00+07:00", "consent": false, "status": "PENDING_CONFIRM"}
```

Expected behavior: Skip the record and log `SKIPPED_NO_CONSENT`.

## Example: Party Size Tolerance

Scenario: A 4-person slot opens. Waitlist candidates have party sizes 2, 3, 4, and 6.

Assuming tolerance of ±2:
- Party size 2: match (within tolerance)
- Party size 3: match (within tolerance)
- Party size 4: exact match
- Party size 6: no match (exceeds tolerance)

Cascade calls candidates in priority order until one accepts or the list is exhausted.

## Example: Time Window Filtering

Scenario: A slot at 2026-09-10T19:00:00+07:00 opens. Waitlist candidates have windows:

| Entry | Window Start | Window End | Slot Match? |
|-------|--------------|------------|-------------|
| W-001 | 2026-09-10T18:00:00+07:00 | 2026-09-10T21:00:00+07:00 | Yes (slot inside window) |
| W-002 | 2026-09-10T19:30:00+07:00 | 2026-09-10T21:00:00+07:00 | No (slot before window) |
| W-003 | 2026-09-10T17:00:00+07:00 | 2026-09-10T18:30:00+07:00 | No (slot after window) |

Only W-001 is eligible for the cascade.

## Example: Budget Exhaustion

Scenario: Budget set to 5 calls. Confirm phase places 3 calls, then 2 cancellations trigger cascade.

Expected behavior:
- After 3 confirm calls, 2 calls remain in budget
- Cascade starts for first cancelled slot
- If waitlist candidate accepts, stop cascade for that slot
- If budget exhausted before second cancelled slot, stop and write back state
- Next run with same run-id skips already-dialed targets

## Example: Rerun with Duplicate Prevention

First run places 3 calls before system failure. Second run with same run-id:

Expected behavior:
- Check audit for already-dialed targets
- Skip R-001, R-002, R-003 (already dialed)
- Log `SKIPPED_DUPLICATE` for each
- Continue with remaining targets
- Audit reflects both original calls and skips

## Example: Cancellation

During execution, operator cancels:

```bash
table-rescue cancel --run-id run-001
```

Expected behavior:
- Stop placing new calls
- Log `CANCELLED_BY_OPERATOR` in audit
- Write back partial state
- Later runs refuse to dial targets from run-001

## Example: Missing Phone Numbers

Scenario: User provides data without phone numbers.

Expected behavior: Fail validation with clear error message before any calls are placed.

## Example: Malformed Phone Numbers

Scenario: User provides phone numbers not in E.164 format.

Input:
```json
{"phone": "(555) 123-4567", ...}
```

Expected behavior: Fail validation, require E.164 format (e.g., +15551234567).
