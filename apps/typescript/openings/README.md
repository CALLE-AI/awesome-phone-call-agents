# Openings

**Standing availability watch for care access.** Tell Openings what care you need, and it
calls the practices that are actually listed — not a database — to verify who is real, who
takes your plan, and who has an opening. If nothing is available, it keeps watching on a
decaying cadence until a slot opens, then stops.

Built on [CALL-E](https://www.heycall-e.com/) (SDK `@call-e/calle`), which places the calls
and returns schema-validated structured results with an evidence quote for every call.

## Why this exists

Provider directories are wrong about two-thirds of the time. A 2025 secret-shopper study of
the Pennsylvania ACA marketplace (8,306 behavioral-health providers) found:

- **65.2%** of verifiable listings had at least one inaccuracy
- **56.6%** had a wrong phone number
- appointments were available for only **14.9%** of listed providers

Directory data cannot be trusted; only a phone call establishes the truth. At CALL-E's cost
per call, calling every listing — repeatedly — becomes affordable for the first time. Every
call returns a verdict (open / waitlist / not accepting / ghost / no answer / reached-but-no-
answer / call failed) with a quoted evidence line and CALL-E's post-call summary the user can
inspect. Dead and misrouted lines accumulate into a verifiable access report.

## What it does

1. **Frame** — build the candidate list from the NPPES NPI Registry by specialty and
   city/state. Every number carries provenance; no number is ever synthesized.
   (`parsePastedRows` / `frameFromPaste` are library helpers and are not wired into
   the UI — a paste path that dials user-supplied numbers needs its own consent design.)
2. **Gate** — the care request is screened for crisis language (stops the search and points to
   988) and for PHI (rejected; Openings never collects diagnosis or medication details).
3. **Verify** — calls are placed strictly one at a time and stop as soon as the
   target number of openings is confirmed. Each call identifies itself as an automated
   assistant and asks only about plan acceptance and availability.
4. **Watch** — when nothing is open, the host scheduler re-calls on a decaying cadence
   (1h, 3h, 7h, 14h, 24h, 48h, 72h, weekly) until an opening appears or the user stops it.

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm check        # typecheck + lint + tests (default suite needs no credentials, no network)
```

Optional access control for a public deployment:

```bash
# Require a shared secret on every page and every mutating action.
# Clients send `Authorization: Bearer <token>` (or Basic with the token as the
# password) or hold an `openings_auth` cookie. Browsers get the Basic prompt.
OPENINGS_AUTH_TOKEN=your-long-random-secret
# Alternative Basic form:
# OPENINGS_BASIC_AUTH=admin:your-long-random-secret
```

**Fail-closed in live mode:** `OPENINGS_CALL_MODE=live` refuses to start unless an auth
secret is configured. A remotely reachable app that can place real calls must never be
anonymous. There is no query-string login — URLs leak into proxy and observability logs.

## Running

| Mode | Config | What happens |
| --- | --- | --- |
| **dry-run** (default) | `OPENINGS_CALL_MODE=dry-run` | Deterministic simulated outcomes, no dialing |
| **live** | `OPENINGS_CALL_MODE=live` + `CALLE_API_KEY` | Real phone calls through the CALL-E API |
| **fake** (tests) | `OPENINGS_CALL_MODE=fake` | Fake caller, no network |

```bash
cp .env.example .env.local   # then edit
pnpm dev
```

### Live validation

Live calls place real-world side effects. To run the live suite, you need a CALL-E account
and API key, and numbers you are authorized to call:

```bash
OPENINGS_LIVE_TESTS=1 pnpm test   # exercises NPPES framing + the full server-action flow
```

## Real-world side effects

- In **live** mode, Openings places real outbound phone calls to the numbers in the candidate
  list. Each call begins by identifying itself as an automated assistant.
- **All pages and actions that can create, run, stop, or reveal results are gated by
  authentication.** Set `OPENINGS_AUTH_TOKEN` (or `OPENINGS_BASIC_AUTH=user:pass`) and
  every request must present it as `Authorization: Bearer <token>` (or Basic) or hold an
  `openings_auth` cookie. Without it, the app returns 401. In live mode the app **refuses to
  start** without a secret (fail-closed), and there is deliberately no query-string login.
- **An explicit recipient authorization is required before any live call.** The start-watching
  form requires you to check "I authorize calls to the providers matching my search" — a public
  NPPES listing alone is never treated as consent. The server rejects the request if that box is
  not checked.
- **Calls are scoped by specialty.** Only NPPES listings registered under the specialty you
  choose are framed and dialed; the specialty is never inferred from the free-text need, and
  the location must include a state — Openings never guesses which region to call.
- **Every run is capped.** Each run places at most `maxCallsPerRun` calls (default 10, up to
  40), even when the target number of openings is never reached. A run that hits the cap
  stops early and reports `call_cap_reached` — it is never presented as "nobody is open".
- **Live calls are slow.** Observed: a call spends 1–4 minutes in IVR/hold before a person
  answers (or voicemail picks up). `LiveCaller` therefore waits up to 6 minutes per call and
  the live test suites allow 8–15 minutes. Plan a small batch (5–10 numbers) for a demo run.
- **Off-hours results are honest.** A call that reaches a closed office returns
  `structured_result: null` → classified `unreachable`, with the CALL-E summary capturing
  "call back Monday 9am" style guidance. Run business-hours batches for positive signals.
- Calls are placed **strictly one at a time**. Cancellation is re-checked immediately before
  every single call, so Stop prevents every subsequent live call — including from an
  already-running dispatch. The CALL-E API does not support cancelling an in-flight call, so
  the call already dialing runs to completion; nothing after it does.
- **Verified availability only.** An `open` verdict that would stop a watch is only treated
  as verified when it comes from a terminal `completed` call with `taskCompleted: true`, no
  failure code, the exact task text, the provider's returned recipient list containing the
  dialed number, and metadata bound to this watch and candidate. Anything else stays
  advisory (`inconclusive`) and never stops the watch. Simulated (dry-run/fake) results are
  never provider-verified.
- **Fail-closed on ambiguity.** A provider timeout, `error` verdict, or any non-terminal result
  immediately stops the run and marks the watch `stopped` so neither the current run
  nor later scheduled ticks can continue dialing with fresh keys.
- **Phone numbers are masked** in watch and report UI (`+1 (***) ***-1234`); full numbers are
  never rendered in summaries, and raw provider call identifiers are not shown in the UI
  (they stay server-side for audit).
- Every practice is called at most once per cooldown window (24h by default) and never again
  once it opts out.
- **CALL-E credentials are pinned to one origin.** `CALLE_API_KEY` is only ever sent to
  exactly `https://api.heycall-e.com` — other hosts, ports, paths, query strings, or schemes
  are rejected before the key is sent.
- The scheduler is **disabled** in fake and dry-run modes.

## Dry-run / preview behavior

- Default mode places no calls: `DryRunCaller` returns deterministic simulated results.
- Tests run against `FakeCaller` with a seeded result table; the default suite requires no
  credentials, no network, and no native-module build (stores are in-memory).

## Cancellation

- **Stop a watch**: the Watch page exposes Stop; a stopped watch is never re-run.
- **Practice opt-out**: opting out a number blocks every future call to it (permanent, until
  manually removed in the store).
- **Scheduler**: `OPENINGS_DISABLE_SCHEDULER=1` (or any non-live `OPENINGS_CALL_MODE`) stops
  the scheduler process from doing anything.

## Storage

- **memory** (default / tests): in-memory store, nothing persisted.
- **sqlite** (production): a single SQLite database. On Fly.io this lives on a persistent
  volume. SQLite means the app is single-writer: run one replica, scale by adding capacity
  to that machine rather than replicas.

## Scheduler

The standing-watch scheduler is a **separate process**, not Next.js instrumentation. This
keeps `next dev` free of server-only native imports (webpack cannot bundle `better-sqlite3`
or `@call-e/calle`, and Next 15 does not honor `serverExternalPackages` for the
instrumentation compile). The scheduler and the Next server share the same SQLite file; WAL
mode supports concurrent processes safely.

- Build: `pnpm build:scheduler` → bundles `dist-scheduler/scheduler.js` with esbuild.
- Run: `node dist-scheduler/scheduler.js` (the Docker image runs it alongside the server).
- The scheduler **no-ops unless `OPENINGS_CALL_MODE=live`** — it never calls in dry-run/fake.
- **One provider call per tick, total.** Per the repository architecture rule, the host
  scheduler handles recurrence and the provider handles one call per scheduled run. Each
  tick selects the single most-due active watch and places at most one real provider call —
  it never loops across every due watch. Manual "Run now" is also sequential (one call at a
  time) up to `maxCallsPerRun`; scheduled ticks place exactly one.

## Deployment

The included `Dockerfile` and `fly.toml` deploy the standalone Next.js server **and** the
scheduler to Fly.io:

```bash
fly launch --no-deploy
fly volumes create openings_data --size 1 --region sin
fly secrets set CALLE_API_KEY=... OPENINGS_CALL_MODE=live OPENINGS_AUTH_TOKEN=your-secret
fly deploy
```

Set `OPENINGS_AUTH_TOKEN` (or `OPENINGS_BASIC_AUTH=user:pass`) to gate all pages and
actions behind authentication; otherwise the app is open (local dev/tests).

## Repository structure

```
src/
  core/        domain logic: schema, classify, frame, dispatch, watch, safety, calle client
  store/       Store interface + MemoryStore + SqliteStore
  app/         application service, runtime config, scheduler, server actions
  components/  UI
  app/         Next.js App Router pages
scripts/       build-scheduler.mjs, scheduler-entry.ts, verify-live.sh
tests/         vitest suites (default run is offline; live tests are opt-in)
dist-scheduler/ esbuild output for the standalone scheduler (gitignored)
```

## Design notes

- **The host owns scheduling.** Per the CALL-E community design principles, recurrence lives
  on the host and CALL-E places exactly one call per scheduled run.
- **Verdicts are computed locally**, never in the prompt. The classifier is a pure function
  with a unit-tested truth table; unknown is never upgraded to a confident verdict.
- **Structured results are strict.** `result_schema` uses enums with `unknown` and an
  evidence field; the SDK's `structuredResult` is re-validated with zod on receipt.

## Go-to-market & roadmap

Openings is built to grow past the hackathon, not to be a one-off demo.

### Initial users

1. **Care navigators, case managers, and patient advocates** who book appointments all day.
2. **Individuals on marketplace plans** trying to find a provider who actually answers.
3. **Payers and health systems** that want to know which listed providers are reachable.

### Go-to-market

Start where directory rot hurts most — **behavioral health** — in a single metro, then expand
specialty by specialty. The product works as a wedge in two directions:

- **Demand side:** "stop dialing twenty numbers — Openings calls and keeps watching until a
  slot opens."
- **Supply side:** the access report (dead lines, wrong entities, misrouted numbers) is
  directory-health data that payers, health systems, and state marketplaces already want but
  don't have. Every ghost we find is a listing someone can fix.

### Roadmap

- **Phase 1 (hackathon):** NPPES framing, honest local classification, the standing watch,
  dry-run and live modes, deployment, and the access report.
- **Phase 2:** multiple directory sources plus a consent-gated paste/CSV import; SMS/email
  alerts when a slot opens; business-hours-aware scheduling; more specialties and
  payer-specific verification.
- **Phase 3:** payer/provider-facing directory-health reports; multi-user accounts and
  scheduling integrations; booking handoff (Openings never books on the caller's behalf);
  HIPAA hardening for navigator and employer use.
