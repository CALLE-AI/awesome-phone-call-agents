# Examples

Phone numbers below use the NANP reserved fictional block (555-0100
through 555-0199). They are safe to publish and are never live-dialed.

## Dry-run the sample board (default, no install)

```bash
python3 scripts/triage_late_hold.py \
  --in assets/sample_holds.csv \
  --now 2026-09-12T19:12:00-04:00
```

Expected shape (numbers masked, zero network calls):

```text
DRY RUN — 3 hold(s). No calls will be placed.
- Jordan Hale     +1202•••••47  slot 19:00  hold 19:20  remaining=8m   fixture=still_coming eta=6  -> KEEP_HOLD
- Sam Okonkwo     +1415•••••88  slot 19:00  hold 19:15  remaining=3m   fixture=still_coming eta=20 -> RELEASE_NOW
- Riley Chen      +1617•••••01  slot 18:45  hold 19:25  remaining=13m  fixture=no_answer           -> NEEDS_HUMAN
Re-run with --confirm and --authorized-numbers to place a real call.
```

Jordan can arrive inside the hold, so the table stays. Sam cannot, so the
host may start a cascade skill. Riley did not answer, so a person decides.

## Replay a single row

```bash
python3 scripts/triage_late_hold.py \
  --in assets/sample_holds.csv \
  --guest-phone +12025550147 \
  --now 2026-09-12T19:12:00-04:00
```

## Live call (operator-owned number only)

```bash
pip install -r requirements.txt
cp assets/authorized_numbers.example.txt authorized_numbers.txt
# replace the example numbers with one E.164 number you are allowed to call

export CALLE_API_KEY=your_calle_key
python3 scripts/triage_late_hold.py \
  --in your_hold.csv \
  --authorized-numbers authorized_numbers.txt \
  --out result.json \
  --confirm
```

Live mode still refuses reserved fictional numbers and any destination
that is not listed in `authorized_numbers.txt`.

## What this is not

- Not "call everyone on tonight's book" — that is appointment confirmation.
- Not "offer this table down the waitlist" — after `RELEASE_NOW`, run
  `standby` or `priority-call-waterfall` as a separate approved job.
- Not a medical, legal, or collections call. Keep `context` to logistics.

Operator contact in docs uses `operator@example.com` only.
