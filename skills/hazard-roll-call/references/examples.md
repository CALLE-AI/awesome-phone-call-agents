# Worked examples

All commands run from `apps/typescript/canopy/` after `npm install`. Phone numbers in this file are
fictional reserved samples (`+1415555xxxx`, `+91555xxxxxx`).

## Example 1: a drill before the heat season

User: "We have the registry export from the council. Rehearse a heat roll call so the team can see
what happens, but do not call anyone."

Agent steps:

```bash
npm run plan -- --registry data/registry.sample.csv --hazard heat --area "Maricopa County, AZ"
```

Show the wave order and confirm the disclosure wording. Then:

```bash
node --import tsx src/cli.ts run --registry data/registry.sample.csv --hazard heat \
  --area "Maricopa County, AZ" --headline "Extreme Heat Warning" --fast --keep-server
```

Report back:

```text
Roll call: Extreme Heat Warning (Maricopa County, AZ) - dry-run
People: 8 consented, 2 skipped (1 no consent, 1 duplicate phone)
Reached: 6/8 (75%) - green 3, yellow 1, red 2, unreachable 1, unverified 1
Red: Rosa Delgado (+14*******01) - dizziness, faint, nausea; not cool; not drinking - contact Miguel: asked for emergency services - ticket dsp_... NEEDS APPROVAL
Red: Harold Finch (+14*******02) - confusion suspected (agent said yellow) - contact Sarah: going, ETA 15 min
Unreachable: Marguerite Bell (+14*******05) - 2 attempts - contact James: going, ETA 15 min
Unverified: Samuel Okafor (+14*******08) - 2 attempts, no contact on file - door-knock ticket
Awaiting human approval: emergency_services for Rosa Delgado
Follow-ups due: Kamla Devi at <time> (fan broken, headache)
Report: data/runs/heat-maricopa-county-az-.../after-action-report.md
Dashboard: http://127.0.0.1:4700
```

The Ahmedabad sample (`data/registry.sample.ahmedabad.csv`) runs the same drill with Hindi and Tamil
speakers and Indian coordinates; pick it from the dashboard's registry selector.

## Example 2: a live roll call during an active alert

User: "IMD has issued a red heat alert for Ahmedabad. Call the registry now."

Agent steps:

1. Confirm: registry path, organisation name for the disclosure, emergency number (108 in India),
   cooling-centre address, wave size, and the time (quiet hours are 21:00-07:00 by default). State the
   count: "24 consented people, one task per person, plus escalation calls for anyone red or
   unreachable. This will consume CALL-E credit."
2. Only after the user confirms in this conversation:

```bash
CANOPY_MODE=live CALLE_API_KEY=... CANOPY_ORG="Ahmedabad Municipal Corporation" CANOPY_EMERGENCY_NUMBER=108 \
CANOPY_TIMEZONE=Asia/Kolkata \
node --import tsx src/cli.ts run --registry data/ahmedabad.private.csv --hazard heat \
  --area "Ahmedabad, Gujarat" --headline "IMD red heat alert" \
  --resource "Cooling centre at the community hall, Maninagar" --confirm
```

3. Relay verdicts as the command prints them. When it finishes, summarise with the output template
   and point at the dashboard and report.

If the alert arrives at night: heat is a life-safety playbook, so the operator may add
`--override-quiet-hours "IMD red alert; overnight minimum 34 C"`; the reason is written to the ledger.

## Example 3: the process was interrupted

User: "The laptop rebooted halfway through. What now?"

```bash
node --import tsx src/cli.ts resume --event-id heat-ahmedabad-gujarat-202606151030 --confirm
```

Resume reattaches to calls that were in flight by call id, re-places any wave CALL-E refused with the
same idempotency keys (so nobody is dialled twice), redials people not reached, and finishes the
cascade. Tell the user which people were `awaiting` and are now settled.

## Example 4: follow-ups two hours later

User: "Check on the yellow people again."

```bash
node --import tsx src/cli.ts follow-up --event-id heat-ahmedabad-gujarat-202606151030 --confirm
```

Add `--now` to ignore due times. The report is rewritten in place.

## Example 5: watch a feed and run automatically (drill mode)

```bash
node --import tsx src/cli.ts watch --nws-area AZ --registry data/registry.sample.csv --interval 15
node --import tsx src/cli.ts watch --nea-psi --hazard smoke --registry data/registry.sample.csv
```

In dry-run mode a matching alert starts a drill. In live mode, `--confirm` is required for automatic
live roll calls; without it the trigger is logged and nothing is dialled.
