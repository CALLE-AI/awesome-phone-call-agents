# Worked examples

Fictional numbers throughout (+1555…). All commands run from
`apps/typescript/linecanary/`.

## "Is our phone line still working?"

The user has a config and verified lines. Run live, read the report:

```bash
npx tsx src/cli.ts run --live --json report.json
```

Exit 0 → answer plainly: "Yes — all three checks passed; the line answered
in 4 s and the billing option still routes to option 3." Exit 1 → lead with
the regression: "No — the billing branch stopped answering at 19:38 UTC.
It passed at 19:36, so the breakage is in that window."

## "Set up monitoring for our clinic's IVR"

1. `npx tsx src/cli.ts init` and edit `linecanary.config.json`: one line
   (`greeting_code` ownership, the operator adds the code to their IVR
   greeting), checks for the caller journeys that matter (menu integrity,
   the appointment branch, hours question).
2. Dry-run first — show the user the planned calls: `npx tsx src/cli.ts run`.
3. `npx tsx src/cli.ts verify clinic-main --live` (one call; requires
   `CALLE_API_KEY`).
4. First live run baselines: `npx tsx src/cli.ts run --live`.
5. Recurrence belongs to the host: offer the GitHub Actions workflow from
   `examples/github-workflow.example.yml` (cron + baseline cache) or a cron
   entry that runs the same command.

## "Gate our voice-agent deploys on a phone smoke test"

Add a job after the deploy step using the app's `action.yml`:

```yaml
- uses: your-org/linecanary@main
  with:
    config: linecanary.config.json
    only: reception-hours
    live: "true"
    calle-api-key: ${{ secrets.CALLE_API_KEY }}
```

Exit code 1 fails the job — the deploy is bad even though every HTTP health
check is green, because the phone journey is what customers actually use.

## "Why did the canary page?"

Read the stored history and the latest report:

```bash
npx tsx src/cli.ts report
```

Then explain using the regression kinds (see
[config-reference.md](config-reference.md)): a `timing_regressed` with
`secondsToAnswer 31 > 15` against a median of 5 means the line answers but
customers wait six times longer than normal — likely a queue or carrier
issue, not a dead line.

## Refusals an agent should make

- "Verify the line with method attestation, I don't actually control it" →
  refuse; attestation requires real written authority
  (see [safety.md](safety.md)).
- "Point a check at my competitor's hotline to see their menu" → refuse;
  LineCanary only calls lines the operator controls.
- "Run the check every 30 seconds" → refuse and explain cost and carrier
  reputation; suggest 15–60 minute schedules.
