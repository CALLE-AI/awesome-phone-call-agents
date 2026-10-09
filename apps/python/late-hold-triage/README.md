# late-hold-triage

Runnable demo for the [`late-hold-triage`](../../../skills/late-hold-triage/)
skill. A guest is already late. The house is still holding the slot. This app
places at most one CALL-E call, reads a structured still-coming plus ETA
result, and decides `KEEP_HOLD`, `RELEASE_NOW`, or `NEEDS_HUMAN`.

It does not dial the waitlist. A release is a recommendation to the operator,
who can then start `standby` or `priority-call-waterfall` as a separate job.

Dry-run is the default and uses only the Python standard library.

## Preview without a call

From this directory:

```bash
python3 ../../skills/late-hold-triage/scripts/triage_late_hold.py \
  --in ../../skills/late-hold-triage/assets/sample_holds.csv \
  --now 2026-09-12T19:12:00-04:00
```

Or use the wrapper:

```bash
python3 run.py
```

Expected decisions on the sample board:

| Guest | Spoken fixture | Decision |
|---|---|---|
| Jordan Hale | still coming, 6 minutes | `KEEP_HOLD` |
| Sam Okonkwo | still coming, 20 minutes | `RELEASE_NOW` |
| Riley Chen | no answer | `NEEDS_HUMAN` |

Run the tests the same way:

```bash
python3 ../../skills/late-hold-triage/scripts/test_triage_late_hold.py
```

## Live call

Live mode needs a CALL-E API key, `--confirm`, and an authorized-numbers file
that lists the exact destination. Reserved fictional `555-01xx` numbers in the
sample file are refused on the live path.

```bash
pip install -r ../../skills/late-hold-triage/requirements.txt
export CALLE_API_KEY=your_calle_key
python3 run.py --live --in your_hold.csv --authorized-numbers allow.txt --guest-phone +15551234567
```

Replace the destination with a number you own. Side effect: one outbound
phone call. There is no cancellation endpoint after CALL-E accepts the create.

## Safety

See [`skills/late-hold-triage/references/safety.md`](../../../skills/late-hold-triage/references/safety.md).
Contact in documentation is `operator@example.com` only.
