# Examples

All phone numbers below are from the North American Numbering Plan's
standards-reserved fictional range (`+1-555-01XX`) and are safe to use in demos,
tests, and documentation.

## Sample job fixture

```json
{
  "job": {
    "description": "water heater leaking in the garage, steady drip, floor and walls still dry",
    "address": "142 Birchwood Ave, Unit 3",
    "customer_name": "Jordan Lee",
    "customer_phone": "+15550100"
  },
  "technicians": [
    { "name": "Priya", "phone": "+15550101" },
    { "name": "Marcus", "phone": "+15550102" },
    { "name": "Dana", "phone": "+15550103" }
  ]
}
```

## Dry-run demo (no CALL-E account needed)

```bash
node skills/emergency-dispatch-cascade/scripts/dispatch-cascade.mjs \
  --job skills/emergency-dispatch-cascade/assets/sample-job.json
```

This replays a written, fixture-based cascade: Priya declines, Marcus accepts with a
35-minute ETA, the cascade stops, and a customer confirmation call is simulated. No
network calls are made and no CALL-E credentials are required.

## Live mode (requires `calle auth login` first)

Live mode needs its own job file with real, authorized, distinct E.164 numbers —
the sample fixture above is in the standards-reserved `+1-555-01XX` range and is
refused as a live destination on purpose:

```bash
node skills/emergency-dispatch-cascade/scripts/dispatch-cascade.mjs \
  --job path/to/real-job.json \
  --live --confirm-live
```

Both `--live` and `--confirm-live` are required together — `--live` alone is
refused — as the explicit statement that every number in the job file is a real,
authorized recipient for this run.

In live mode, the script shells out to the installed `calle` CLI for each phase
instead of replaying fixtures. A detected acceptance is advisory only: the script
prints an `advisory_acceptance` line and blocks on a prompt, and only proceeds to
call the customer once the operator types `CONFIRM` and enters the ETA themselves.
If the operator does not confirm, the run ends with nobody booked and no customer
call placed. Raw live transcripts are withheld from the script's own log output
(see [`references/safety.md`](safety.md)).

The final `customer_call_completed` field reports transport completion only.
For a live call, `customer_confirmed` remains `null` until a person reviews the
answer; a completed call does not prove that the customer agreed to be home.

Under the hood, each phase is one `calle` CLI invocation shaped like this (the
fixture number below is illustrative only — the script itself refuses to dial it
live; substitute a real, authorized number to actually run this by hand):

```bash
calle call plan --to-phone "+15550101" \
  --goal "Ask Priya if she can take an urgent water heater leak job at 142 Birchwood Ave, Unit 3. Confirm yes/no and, if yes, her ETA in minutes."

calle call start --to-phone "+15550101" \
  --goal "Ask Priya if she can take an urgent water heater leak job at 142 Birchwood Ave, Unit 3. Confirm yes/no and, if yes, her ETA in minutes."

calle call status --run-id "<run_id>"
```

On acceptance, the customer confirmation call follows the same pattern:

```bash
calle call start --to-phone "+15550100" \
  --goal "Tell Jordan that Marcus is on the way for the water heater leak, ETA about 35 minutes. Confirm they will be home."
```

## Reading an unreadable answer

If a technician's transcript comes back as, for example, "maybe, let me check with my
other job first" — this is not a yes and not a no. The correct behavior is to halt
the cascade, report the exact quote, and wait for a human to decide whether to treat
it as a decline (and advance) or to call back once the technician confirms. See
[`references/safety.md`](safety.md) for the full rule.
