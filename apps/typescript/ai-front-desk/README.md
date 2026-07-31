# AI Front Desk

An AI receptionist for appointment-based service businesses (clinics, salons,
tutors, home-service providers) that keeps the calendar full over real CALL-E
phone calls, instead of a text reminder nobody reads.

Three flows share one calendar so they reinforce each other instead of being
three disconnected demos:

1. **Confirm** — the day before an appointment, CALL-E calls the client to
   confirm attendance or offer a reschedule from the business's own open
   slots.
2. **Backfill (priority call waterfall)** — the moment a slot frees up (a
   no-show, a cancellation, a declined confirmation), the app calls down a
   priority waitlist, one contact at a time, until someone accepts the
   opening.
3. **Qualify & book** — a new inbound inquiry gets a short qualifying call
   (what do they need, how soon) and is booked straight into the next open
   slot, or added to the waitlist if nothing is open yet.

A dashboard shows the appointments, the waitlist, the leads inbox, and a
call-activity log with every goal sent to CALL-E, the structured result that
came back, and the transcript — so it's visible, not a black box.

<p>
  <img src="docs/screenshots/appointments.png" alt="Appointments dashboard" width="800">
</p>

Active development happens at
[github.com/LihanCanCode/Ai_FrontDesk](https://github.com/LihanCanCode/Ai_FrontDesk); this
directory is kept in sync with it at submission checkpoints.

## Try it without spending a call

Everything below runs with `CALLE_DRY_RUN=true` (the default). No SDK call is
made, no network request leaves the process, no credentials are required.
Instead, each flow logs the exact goal + JSON schema it would have sent and
records a deterministic mock result, so every code path — including the full
multi-candidate backfill waterfall — is exercisable offline.

```bash
cd apps/typescript/ai-front-desk
npm install
cp .env.example .env
npm run db:migrate     # creates dev.db and seeds Riverside Dental Clinic
npm run web:build      # builds the dashboard once
npm start              # http://localhost:3000 (set PORT in .env to change)
```

Open the dashboard and:

- **Appointments** — click "Confirm now" on an unconfirmed appointment, or
  "Cancel & backfill" to free a slot and watch the waterfall call down the
  waitlist in priority order.
- **Leads** — submit a new inquiry and watch it get qualified and booked (or
  waitlisted) in real time.
- **Call Activity** — expand any row to see the exact goal sent to CALL-E,
  the structured result, and the transcript.

Automated tests (13, no credentials, no network beyond loopback):

```bash
npm test        # tsc has already run in check; this runs prompt, flow, and
                # fake-CALL-E-server tests, including one that drives the
                # real @call-e/calle SDK against a local fake server
npm run check   # tsc --noEmit
```

## One live call

Real calls only ever go to **your own verified number** — never to a contact
in the database, live or seeded. This is enforced in code
([`src/calle/client.ts`](src/calle/client.ts)), not just documentation: the
live path ignores whatever phone number a flow was about and always dials
`LIVE_CALL_OVERRIDE_PHONE`.

```bash
# in .env:
CALLE_API_KEY=<your key from the CALL-E dashboard>
LIVE_CALL_OVERRIDE_PHONE=+1XXXXXXXXXX   # E.164, your own number
CALLE_DRY_RUN=false

npm run hello-call   # places ONE real call as an integration smoke test
```

Flip `CALLE_DRY_RUN` back to `true` afterward — the dashboard's simulate
buttons and the cron sweep both read this flag on every call, so leaving it
`false` means every subsequent click places a real call against your free
tier's call budget (the dashboard sidebar shows a live `X/20 real calls used`
counter).

## Side effects, credentials, and cancellation

- **Recurring job**: a daily cron sweep (`CONFIRM_CRON`, default `0 9 * * *`)
  calls every appointment that's unconfirmed and starting within the next 24
  hours. **To disable it**, set `CONFIRM_CRON_ENABLED=false` in `.env` and
  restart — there is nothing else to clean up; the sweep is stateless and
  re-derives its worklist from the database each time it runs.
- **Credential handling**: `CALLE_API_KEY` is read from the environment only,
  never logged, never stored in the database. The live-call path
  (`assertTrustedBaseUrl` in [`src/calle/client.ts`](src/calle/client.ts))
  refuses to send the key anywhere except `api.heycall-e.com`, or loopback
  hosts for local fake-server testing — exact hostname match, no wildcards.
- **Dry-run by default**: `CALLE_DRY_RUN=true` out of the box. Every flow
  (confirm, backfill, qualify) and the hello-world smoke test all route
  through the same `runCall()` gate in `src/calle/client.ts`, so there is no
  code path that places a real call unless this flag is explicitly disabled.
- **No hidden schedules**: the only recurring job is the confirmation sweep
  described above; the backfill and qualify flows are triggered by a specific
  event (a slot freeing up, a new lead) and place at most one call chain per
  event, never a repeating job.
- **Sample data**: all contact numbers in `prisma/seed.ts` are fictional
  (`+1555...` reserved range). If you point `LIVE_CALL_OVERRIDE_PHONE` at a
  real number, that is the only number CALL-E will ever be asked to dial in
  live mode.
- **Boundaries**: every prompt sent to CALL-E (see `src/flows/*/prompt.ts`)
  explicitly instructs it not to give medical, legal, or financial advice,
  and to leave a voicemail and report an unknown/no-booking outcome rather
  than guess when it can't reach a person.

## Architecture

Express serves both the JSON API and the built React dashboard from one
long-running process — needed because a CALL-E call
(`client.calls.createAndWait`-equivalent) blocks for the real duration of a
phone call, and the confirmation cron needs a persistent process, both of
which rule out a classic serverless function host. Prisma + SQLite hold the
shared data model (`Business`, `Contact`, `Slot`, `Appointment`,
`WaitlistEntry`, `Lead`, `CallLog`).

Every flow (`src/flows/confirm`, `src/flows/backfill`, `src/flows/qualify`)
splits into a pure `prompt.ts` (builds the natural-language goal + JSON
result schema, no I/O, unit-tested directly) and a `*Flow.ts` that does the
database read/write around a single call to `runCall()`. The dashboard's
"simulate" buttons and the cron scheduler call the **exact same** flow
functions — see `src/routes/index.ts` vs `src/cron/scheduler.ts` — so there
is no separate demo-only code path; simulating an event only sets up the
triggering state (e.g. pulling a slot's start time into the 24h window) and
then runs the same sweep or single-item function production traffic would.

```
src/calle/client.ts       — the only file importing @call-e/calle
src/flows/<flow>/prompt.ts — pure goal + JSON-schema builder
src/flows/<flow>/*Flow.ts  — DB reads/writes around one runCall()
src/routes/index.ts        — REST API + manual "simulate" triggers
src/cron/scheduler.ts      — daily confirmation sweep
fake/calle-server.ts       — local stand-in for the CALL-E API, used by tests
```

This is a demo app for a workflow pattern, not a CALL-E SDK and not a
supported product API.
