# Examples

## 1. Dry run (no calls placed)

```bash
export CALLE_API_KEY=calle_live_xxxxxxxx
python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --dry-run
```

Sample output:

```
Appointment batch (3 recipients) — DRY RUN, no calls will be placed:

1. Alex Rivera   +1415•••••01   2026-09-08T15:00:00-04:00   annual checkup with Dr. Rao
2. Priya Nair    +9198••••••70   2026-09-08T11:30:00+05:30   car pickup for invoice #4021
3. Wei Tan       +6591••••67   2026-09-08T09:00:00+08:00   haircut appointment

Type CONFIRM to place these 3 calls, or anything else to cancel:
```

## 2. Real run after approval

```bash
python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --out results.csv
```

Each recipient is called serially, polled to a terminal state, and written to
`results.csv`:

```csv
recipient_name,phone_masked,appointment_time,call_id,status,requested_new_time
Alex Rivera,+1415•••••01,2026-09-08T15:00:00-04:00,call_8f2a1c,confirmed,
Priya Nair,+9198••••••70,2026-09-08T11:30:00+05:30,call_9b7e40,needs_reschedule,2026-09-09T11:30:00+05:30
Wei Tan,+6591••••67,2026-09-08T09:00:00+08:00,call_31dd2f,no_answer,
```

Batch summary printed at the end:

```
1 confirmed, 1 to reschedule, 0 declined, 1 no answer, 0 failed
```

## 3. Minimal appointments.csv format

```csv
recipient_name,phone,appointment_time,context,business_name
Alex Rivera,+14155550101,2026-09-08T15:00:00-04:00,annual checkup with Dr. Rao,Sunrise Clinic
```

`region` and `locale` are optional columns — `region` is inferred from the
phone's country code when omitted (see `references/result-schema.md`).

## 4. Maintaining a pre-approved recipient list

`assets/authorized_numbers.example.txt` shows a simple format hosts can use
to track which numbers have an existing, verified appointment on file before
they're ever added to an `appointments.csv` batch. This is a manual/host-side
record — a starting template if you want to keep an audit trail of "who is
allowed to be on tomorrow's confirmation-call list" separately from the
appointment data itself — not a flag this script reads automatically. Cross-
check new rows against it before running a batch, per the sourcing rule in
`references/safety.md`.
