# fintech-collections-callback

A runnable phone-call workflow app that places **consent-gated, compliant
payment-reminder calls** to overdue fintech accounts using
[CALL-E](https://www.heycall-e.com), and returns a **structured collections
outcome** per account (promise-to-pay date, dispute, or callback request).

It is built for the exact place voice agents earn their keep in lending and BPO
operations: first-party soft collections and appointment/payment reminders —
where *who you may call, when, and what you may say* is as important as the call
itself. An operator (or an agent administering this workflow) hands the app a
batch of accounts; the app decides which ones are eligible to dial right now,
places those calls under a spend cap, and writes an auditable report.

## What it does

1. Loads a batch of overdue accounts (sample fixtures included).
2. Runs a **pre-dial gate** on each account:
   - explicit, timestamped **consent** to be contacted;
   - valid **E.164** phone number;
   - valid **IANA timezone**, used to enforce **quiet hours** (no calls before
     08:00 or at/after 21:00 local time);
   - a per-run **spend cap** on the number of calls.
3. For each allowed account, calls CALL-E with a task whose compliance rules are
   fixed in code (identify as automated, right-party only, no threats, never
   collect payment on the call), and a `recipientResultSchema` so the result
   comes back structured.
4. Writes a JSON report of every decision and outcome.

CALL-E is imported and invoked at runtime in
[`src/calle.ts`](src/calle.ts); orchestration and the gate live in
[`src/client.ts`](src/client.ts) and [`src/gate.ts`](src/gate.ts).

## Setup

Requires Node.js 20+.

```bash
npm install
```

## Credentials

Only **live** runs need credentials. Provide them either way:

- **A `.env` file** — copy `.env.example` to `.env` and fill it in. If a `.env`
  exists in this directory it is loaded automatically at startup (via Node's
  built-in `process.loadEnvFile`; requires Node ≥ 20.12). `.env` is git-ignored.
- **Or shell variables** — export them yourself, e.g. PowerShell
  `$env:CALLE_API_KEY = "…"` or bash `export CALLE_API_KEY=…`.

Variables:

- `CALLE_API_KEY` — your key from the CALL-E dashboard. **Required for `--live`.**
- `CALLE_BASE_URL` — optional; defaults to `https://api.heycall-e.com`.

The key is read from the environment only and never written to logs. A dry-run
needs no key, so no `.env` is required for it.

## Dry-run / preview behavior (default)

The app is **dry-run by default and places no calls**. It runs the full gate and
prints exactly which accounts *would* be dialed and which are blocked and why —
counting eligible accounts against the same spend cap a live run would use.

```bash
npm run dry-run
# or override the cap:
npm run dev -- --max-calls=3
```

`npm test` runs the gate unit tests with no credentials, network, or calls.

## Going live

```bash
# with CALLE_API_KEY set in your environment or .env
npm run live
npm run dev -- --live --max-calls=5
```

Each eligible account triggers one real outbound call via
`client.calls.createAndWait(...)`, guarded by a deterministic idempotency key
(`collections_<accountId>_<dueDate>`) so a re-run never double-dials.

> **Never `--live` against the sample fixtures.** Their numbers are
> reserved-for-fiction (e.g. `+12025550143` passes the gate) and must not be
> dialed. Use the smoke test below to place a real call to a number you control.

### Live smoke test (one number you control)

`--smoke` ignores the fixtures and builds a **single** recipient from `SMOKE_*`
environment variables, then hard-caps the run at one call. It runs the same
pre-dial gate as a full batch. Preview it in dry-run first (no call placed):

```bash
SMOKE_PHONE=+1XXXXXXXXXX SMOKE_CONSENT=true npm run dev -- --smoke
```

When the preview shows `would call …`, place the real call:

```bash
# CALLE_API_KEY must be set; consent is OFF unless you set SMOKE_CONSENT=true
SMOKE_PHONE=+1XXXXXXXXXX SMOKE_CONSENT=true npm run dev -- --live --smoke
```

> The inline `VAR=value command` form above is bash-only. On Windows/PowerShell,
> set each first (`$env:SMOKE_PHONE = "+1XXXXXXXXXX"`), **or** — simplest — put
> `CALLE_API_KEY` and the `SMOKE_*` values in `.env` (auto-loaded) and just run
> `npm run dev -- --live --smoke`.

Recognized variables (only `SMOKE_PHONE` is required):

| Variable | Default | Notes |
| --- | --- | --- |
| `SMOKE_PHONE` | — | **Required.** E.164 number you control and consent to call. |
| `SMOKE_CONSENT` | `false` | Must be `true` or the gate blocks with `no-consent`. |
| `SMOKE_CONSENT_TIMESTAMP` | now | ISO datetime; auto-set when consent is `true`. |
| `SMOKE_NAME` | `Test Customer` | Name the agent asks for. |
| `SMOKE_TIMEZONE` | this machine's zone | IANA id; drives quiet-hours (08:00–21:00 local). |
| `SMOKE_REGION` | `US` | ISO 3166-1 alpha-2. |
| `SMOKE_AMOUNT_CENTS` / `SMOKE_CURRENCY` | `10000` / `USD` | Amount quoted on the call. |
| `SMOKE_DUE_DATE` / `SMOKE_DAYS_PAST_DUE` | derived / `30` | Due date and days past due. |
| `SMOKE_ACCOUNT_ID` | `SMOKE-1` | Part of the idempotency key — change it to force a fresh call. |
| `SMOKE_LANGUAGE` | `en-US` | BCP-47 locale for the spoken call. |

## Side effects

- **Live mode places real phone calls** that cost money (CALL-E bills per
  billable call) and are subject to telecom regulations in the recipient's
  jurisdiction. You are responsible for having a lawful basis and consent to
  call each recipient.
- Dry-run mode has no external side effects.
- The only local side effect is a report written under `runs/` (see below).

## Cancellation and rollback

- Press **Ctrl-C** to cancel a run: no new call is started, the in-progress
  report is still written, and remaining accounts are left untouched.
- Because the idempotency key is derived from the account and due date, safely
  **re-running the batch will not re-dial** accounts already handled for that
  billing cycle — the effective rollback for "I ran it twice."
- A call already answered cannot be un-placed; the report records it so
  operators can reconcile.

## Where results are stored

Every run writes a timestamped JSON report to `runs/<ISO-timestamp>.json`
containing the mode, spend cap, per-account decisions, structured outcomes, and
estimated cost. The `runs/` directory is git-ignored.

## Project layout

```
fintech-collections-callback/
├── src/
│   ├── client.ts     # entry point: batch loop, spend cap, cancellation, report
│   ├── gate.ts       # consent + E.164 + IANA timezone + quiet-hours checks
│   ├── calle.ts      # the only CALL-E SDK integration (task + structured result)
│   ├── fixtures.ts   # sample accounts (fictional numbers; some intentionally blocked)
│   ├── smoke.ts      # SMOKE_* env -> single recipient for a one-number live test
│   ├── types.ts      # domain types
│   ├── gate.test.ts  # gate unit tests (no network)
│   ├── calle.test.ts # result-mapping unit tests (no network)
│   └── smoke.test.ts # SMOKE_* account-builder unit tests (no network)
├── .env.example
├── package.json
└── tsconfig.json
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dry-run` | Full gate, no calls (default) |
| `npm run live` | Place real calls (needs `CALLE_API_KEY`) |
| `npm run dev -- <args>` | Run directly with custom flags (`--live`, `--smoke`, `--max-calls=N`) |
| `npm run dev -- --smoke` | One-number test from `SMOKE_*` env (add `--live` to dial) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests — gate, result mapping, smoke builder (no network) |

## License

MIT
