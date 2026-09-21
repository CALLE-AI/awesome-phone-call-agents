# fintech-collections-callback

A runnable experimental phone-call workflow app that demonstrates **consent-gated
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
3. For each allowed account, calls CALL-E with a task that **instructs the agent to
   verify the right party before disclosing any debt detail**, keeps safety rules fixed in
   code (identify as automated, no threats, never collect payment on the call),
   and passes a `recipientResultSchema` so the result comes back structured.
4. Writes a JSON report of every decision and outcome, with **phone numbers masked**.

CALL-E is imported and invoked at runtime in
[`src/calle.ts`](src/calle.ts); orchestration and the gate live in
[`src/client.ts`](src/client.ts) and [`src/gate.ts`](src/gate.ts); the safety
boundary helpers live in [`src/safety.ts`](src/safety.ts).

## Safety boundaries and demo limitations

- **Live never dials the checked-in fixtures.** `--live` fails closed unless an
  operator supplies the recipient at run time via `--smoke` (`SMOKE_*` env);
  fixtures are dry-run preview only.
- **Credentials stay on-net.** `CALLE_BASE_URL` is allowlisted to official
  `https://*.heycall-e.com` (or a loopback host) before the bearer key is
  attached — it is never sent to an arbitrary origin.
- **Right-party first is a prompt instruction, not an identity guarantee.** The
  agent is instructed to withhold debt details until identity is confirmed and
  end the call for a wrong party. This demo does not certify model compliance.
- **Outputs are masked.** Destinations and recognized international-format phone
  text are masked in reports; provider errors are replaced with generic diagnostics.
  This is not a general personal-data scrubber: keep local reports private.
- **Ambiguous calls halt the batch.** If a create/wait error leaves it unknown
  whether a call was placed, the run stops and records the outcome as
  `unresolved` for reconciliation, rather than risking another side effect.

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
  **Allowlisted**: only official `https://*.heycall-e.com` origins (or a loopback
  host for local testing) are accepted — the app refuses to send the key anywhere else.

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

Live mode **fails closed on the sample fixtures** — it will not dial them.
`npm run dev -- --live` on its own exits with an error. A real call only goes to
a recipient you supply at run time via `--smoke` (`SMOKE_*` env), so it always
targets an operator-authorized number.

Each call goes out via `client.calls.createAndWait(...)`, guarded by a
deterministic idempotency key (`collections_<accountId>_<dueDate>`) to request
provider deduplication, subject to its retention and semantics. If a create/wait error leaves the outcome ambiguous, the run
**halts** and marks it `unresolved` instead of continuing.

### Live smoke test (one number you control) — the only live path

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
- The call prompt **requests right-party verification before disclosing** the
  amount or due date; this is an experimental safeguard, not certified identity
  verification, legal compliance, or authorization for automatic collections action.
- Phone numbers are **masked** in console output and in the JSON report.
- Dry-run mode has no external side effects.
- The only local side effect is a report written under `runs/` (see below).

## Cancellation and rollback

- Press **Ctrl-C** to cancel a run: no new call is started, the in-progress
  report is still written, and remaining accounts are left untouched.
- The account/due-date key requests provider deduplication; it is not a durable
  local call checkpoint. Reconcile ambiguous outcomes before any manual rerun.
- A call already answered cannot be un-placed; the report records it so
  operators can reconcile.
- If a call's creation is **ambiguous** (it may have been accepted before the
  error), the run **halts** and records the outcome as `unresolved` — no further
  call is placed until an operator reconciles it.

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
│   ├── safety.ts     # base-URL allowlist, output masking, fail-closed live guard
│   ├── fixtures.ts   # sample accounts (fictional numbers; some intentionally blocked)
│   ├── smoke.ts      # SMOKE_* env -> single recipient for a one-number live test
│   ├── types.ts      # domain types
│   ├── gate.test.ts  # gate unit tests (no network)
│   ├── calle.test.ts # result-mapping + right-party task tests (no network)
│   ├── safety.test.ts# allowlist / masking / fail-closed tests (no network)
│   └── smoke.test.ts # SMOKE_* account-builder unit tests (no network)
├── .env.example
├── package.json
└── tsconfig.json
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dry-run` | Full gate, no calls (default) |
| `npm run live` | Live call to the operator-supplied `SMOKE_*` recipient (needs `CALLE_API_KEY`) |
| `npm run dev -- <args>` | Run directly with custom flags (`--live`, `--smoke`, `--max-calls=N`) |
| `npm run dev -- --smoke` | One-number test from `SMOKE_*` env (add `--live` to dial) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests — gate, mapping, right-party task, safety boundary, smoke (no network) |

## License

MIT
