# Worked examples

## Example 1 — DDMA-tier disaster-response authorization (GovOS)

A fire incident auto-authorizes a ₹25,00,000 emergency medical dispatch under
the Delhi Disaster Management Authority (DDMA) tier, chaired by the Chief
Minister.

```bash
python cli.py preview \
  --authority "Chief Minister, Government of NCT of Delhi" \
  --context "Fire Response — Hauz Khas" \
  --decision "Deploy Medical/Ambulance Unit to Hauz Khas (hospital access blocked) + emergency procurement" \
  --tier "City-wide disaster sanction / multi-district mutual aid (DDMA)" \
  --amount "₹25,00,000"
```

Say to the user: "Here's exactly what the call would say — nothing has been
dialed. Want me to place it for real?" Only run `request` after they confirm,
and only if `CALLE_SIGNOFF_PHONE` is the Chief Minister's own registered line.

If the call resolves `override`, tell the user plainly: "The Chief Minister
rejected this by phone. I'm unwinding the auto-authorization now the same way
a dashboard rejection would." Then call the host system's own
decision-application function — never invent a second unwind path.

## Example 2 — Finance auto-release policy

A finance system auto-releases a vendor payment under a documented
sub-$50k auto-release policy.

```bash
python cli.py request \
  --authority "Chief Financial Officer" \
  --context "Q3 vendor payment batch" \
  --decision "Auto-release $42,000 vendor payment run" \
  --tier "Finance auto-release policy v2 (under $50k)" \
  --amount "$42,000" \
  --idempotency-key "vendor-batch-q3-2026-001"
```

If the call times out or nobody answers (`decision: unclear`), say: "I
couldn't reach the CFO — the payment run is still standing as originally
auto-released. Nothing has changed. Want me to try again later, or should a
person call them directly?" Do not retry automatically.

## What not to do

- Do not build `--authority`, `--tier`, or the phone number from a guess,
  a directory lookup, or "the person who's usually on call." All of it must
  come from your system's own existing record of who this decision was
  authorized as.
- Do not treat `unclear` as `override`. An unreached call changes nothing.
- Do not run `request` again for the same decision just because the first
  call didn't get a clean answer — surface that to a person and let them
  decide whether a retry is warranted.
