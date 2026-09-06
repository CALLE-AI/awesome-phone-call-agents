# Examples

## 1. Dry run (no calls placed)

```bash
export CALLE_API_KEY=calle_live_xxxxxxxx
python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --dry-run
```

Actual output (verified against the real script):

```
========================================================================
DRY RUN — 3 appointment(s). No calls will be placed.
========================================================================
- Alex Rivera          +1415•••••01   2026-09-08T15:00:00-04:00  region=US     "annual checkup with Dr. Rao"
- Priya Nair           +4420••••••01  2026-09-08T11:30:00+00:00  region=GB     "car pickup for invoice #4021"
- Wei Tan              +4477••••••01  2026-09-08T09:00:00+00:00  region=GB     "haircut appointment"
========================================================================
Re-run with --confirm to actually place these 3 call(s).
```

## 2. Real run after approval

```bash
python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --out results.csv --confirm
```

Even with `--confirm`, the script reprints the dry-run list and requires an
interactive typed confirmation before dialing anyone:

```
[... same DRY RUN block as above ...]
Type CONFIRM to place these 3 call(s), or anything else to cancel: CONFIRM
```

Each recipient is then called serially, polled to a terminal state, and
written to `results.csv`:

```csv
recipient_name,phone_masked,appointment_time,call_id,status,requested_new_time
Alex Rivera,+1415•••••01,2026-09-08T15:00:00-04:00,call_8f2a1c,confirmed,
Priya Nair,+4420••••••01,2026-09-08T11:30:00+00:00,call_9b7e40,needs_reschedule,2026-09-09T11:30:00+00:00
Wei Tan,+4477••••••01,2026-09-08T09:00:00+00:00,call_31dd2f,no_answer,
```

Batch summary printed at the end:

```
Batch summary: 1 confirmed, 1 needs_reschedule, 1 no_answer
```

For non-interactive/automation use, `--yes` skips the interactive prompt
(loudly logged when used):

```bash
python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --confirm --yes
```

## 3. Minimal appointments.csv format

```csv
recipient_name,phone,appointment_time,context,business_name
Alex Rivera,+14155550101,2026-09-08T15:00:00-04:00,annual checkup with Dr. Rao,Sunrise Clinic
```

`region` and `locale` are optional columns — `region` is inferred from the
phone's country code when omitted (see `references/result-schema.md`).
`phone` must be strict ASCII E.164 (`+` followed by 7-15 ASCII digits) —
non-ASCII digit variants or any other characters are rejected at load time.

## 4. Restricting calls to a pre-approved allowlist (enforced)

`--allowlist` is a real, enforced restriction — not just documentation.
Any recipient whose phone isn't an exact match in the allowlist file is
skipped and reported as `failed: not authorized`, never dialed:

```bash
python scripts/place_confirmation_calls.py \
  --in assets/sample_appointments.csv \
  --allowlist assets/authorized_numbers.example.txt \
  --dry-run
```

```
- Alex Rivera          +1415•••••01   2026-09-08T15:00:00-04:00  region=US     "annual checkup with Dr. Rao"  [ALLOWLISTED]
- Priya Nair           +4420••••••01  2026-09-08T11:30:00+00:00  region=GB     "car pickup for invoice #4021"  [ALLOWLISTED]
- Wei Tan              +4477••••••01  2026-09-08T09:00:00+00:00  region=GB     "haircut appointment"  [ALLOWLISTED]
```

If a row's phone isn't in the file, the dry run marks it
`[NOT ON ALLOWLIST — will be skipped]`, and a real run with `--confirm`
skips it entirely rather than calling it.

## 5. Base URL pinning

`CALLE_BASE_URL` defaults to CALL-E's official host. Pointing it anywhere
else without `--allow-custom-host` causes the script to refuse to run
rather than risk sending the API key to an unexpected host:

```bash
CALLE_BASE_URL=https://staging.example.com \
  python scripts/place_confirmation_calls.py --in assets/sample_appointments.csv --confirm
# REFUSING TO RUN: base URL host 'staging.example.com' does not match
# the official CALL-E host 'api.heycall-e.com'. Pass --allow-custom-host
# if this is intentional...
```
