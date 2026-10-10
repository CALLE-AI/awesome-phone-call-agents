# MinuteOne

Instant lead-callback qualification agent, built on [CALL-E](https://github.com/CALLE-AI/call-e-integrations)
for the "Your Code Is Calling" hackathon. When a prospect submits a lead form, MinuteOne calls
them back, runs a config-driven qualification conversation, and returns a scored LeadCard —
turning "someone filled out a form" into "someone we already know is worth a callback" within
about a minute, without a human ever having to place the first call.

**Host / provider:** [CALL-E](https://github.com/CALLE-AI/call-e-integrations) is the only
external calling provider this app talks to (via its MCP server — see
[How it works](#how-it-works)). Everything else (database, hosting) is swappable infrastructure,
not a "supported host" in the Agent Skills sense.

## Setup

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No external services, accounts, or credentials are required —
`predev` creates a local SQLite file (`local.db`) automatically, and the app runs in **dry-run
mode by default** (no real phone calls are placed; see [Dry-run vs real
calls](#dry-run-vs-real-calls)).

## Usage

1. Submit a lead on the home page (name, E.164 phone, optional email/notes, and the required
   consent checkbox).
2. Watch it move through `pending → in_progress → done` on
   [`/review`](http://localhost:3000/review) as the in-process worker dispatches it (polls every
   5s). Click a row for the full LeadCard: outcome, score, per-question answers, call metadata.
3. To configure the business — opening line, 3–5 qualification questions, scoring weights — use
   [`/setup`](http://localhost:3000/setup) in the app itself: enter the business info, set the
   qualifying questions, then the live lead form appears right there so you can submit a test lead
   against exactly what you just configured. `lib/config/business.example.json` is only the seed
   default the very first time the app runs; `/setup` is the normal way to change it from then on.

## How it works

```
Lead form → leads table (SQLite/Turso) → worker (poller / Netlify scheduled fn)
  → dispatchLead(): consent + business-hours check → CallProvider.placeCall()
  → outcome + rubric score mapped to a LeadCard → written back → shown in /review
```

- **Config-driven, single business**: the business identity/opening line, qualification
  questions, scoring rubric, and business-hours window live as one JSON blob in a single DB row
  (`lib/db/schema.ts`'s `businessConfig` table — exactly one row, validated by
  `lib/config/schema.ts`'s `businessConfigSchema` on every read/write). `lib/config/load.ts`
  lazily seeds that row from `business.example.json` the first time the app ever runs (with an
  always-open business-hours default so a fresh `/setup` can be live-tested immediately, rather
  than silently hanging on the hours gate); `/setup`'s save endpoint (`/api/config`) is what
  updates it after that. No hardcoded call scripts.
- **`CallProvider`** (`lib/call/provider.ts`): the interface CALL-E is plugged in behind.
  `lib/call/fake.ts` is the dry-run implementation (simulated delay, weighted-random outcomes,
  synthetic answers) and is the default everywhere. `lib/call/calle.ts` is the real provider —
  CALL-E has no REST/SDK surface, only an OAuth-protected MCP server (`calle mcp config` shows
  `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`), so it's an
  `@modelcontextprotocol/sdk` client driving `plan_call` → `run_call` → poll `get_call_run`.
  There's no structured-result-schema parameter on the real API — confirmed via a real verification
  call (see [Build status](#build-status)) — so a completed real call's qualification answers are
  recovered from its prose `summary`/`transcript` instead: `lib/call/extract.ts` (an optional LLM
  pass, used only if `ANTHROPIC_API_KEY` is set) falling back to `lib/call/extract-heuristic.ts`
  (a free local regex/keyword parser, always available, no credential needed).
- **`dispatchLead`** (`lib/worker/dispatch.ts`): the single shared dispatch core, called by both
  the local poller and the Netlify scheduled function. Atomically claims a lead (an
  `UPDATE ... WHERE status='pending'` in one statement, not a separate read-then-write) so two
  overlapping worker ticks can never both dispatch the same lead, enforces consent, gates on
  business hours, applies the retry policy (max 1 retry on no_answer/voicemail, never on
  declined), scores answers against the config's rubric, and maps the result onto the fixed
  LeadCard outcome enum (`qualified | not_qualified | callback_requested | no_answer |
  wrong_number | declined`).
- **Worker wiring**: locally, `instrumentation.ts` starts an in-process `setInterval` poller
  (`lib/worker/poller.ts`) once per dev server instance. The Netlify deploy uses a 1-minute
  scheduled function instead (`netlify/functions/sweep-scheduled.ts`), since Netlify functions
  have no long-running process to host a poller and an ephemeral filesystem SQLite can't survive
  on — both call the same `lib/worker/sweep.ts`.

## Side effects

- **Placing a real phone call** — only when `DRY_RUN=false` and `CALLE_API_KEY` are both set (see
  below). Every other operation (submitting a lead, viewing `/review`, editing the config on
  `/setup`) is local/in-memory/database-only and has no external effect.
- **A recurring background job**, disclosed, not hidden: locally, a `setInterval` poller runs
  every 5 seconds for as long as the dev server process is alive. On the deployed instance, a
  Netlify Scheduled Function (`netlify/functions/sweep-scheduled.ts`) runs every 1 minute for as
  long as the site exists. Both only ever act on leads already sitting in the database with
  `status = "pending"` — they never originate a lead or a call on their own initiative.
- **Writes to a database** — `local.db` (a plain file in this directory) by default, or a hosted
  Turso database when `TURSO_DATABASE_URL` is set (deployed instance only).

## Dry-run vs real calls

Dry-run (`FakeCallProvider`) is the default everywhere. Real calls require an explicit opt-in:

```bash
DRY_RUN=false CALLE_API_KEY=... npm run dev
```

Only 20 real CALL-E calls are available for this whole project, so real calls are reserved for
verification and demo-video recording — not day-to-day iteration. CALL-E only places calls to a
specific set of supported countries (confirmed: US, UK, Canada, Australia, Singapore, Ireland —
see [CALL-E's supported regions
doc](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages) for the
full list); it rejects unsupported numbers at the free planning step, before anything is dialed
or spent. It also rejects reserved test numbers (555-xxxx) the same way, so real verification
needs an actual phone number in a supported region, not the masked examples used elsewhere in
this repo.

## Credential handling

- **No credentials at all are needed to run this app locally in its default mode.**
- **`CALLE_API_KEY`** (only needed for real calls): CALL-E has no separate "API key" page — it's
  a bearer token from its OAuth-protected MCP server. Get one by installing the CLI
  (`npm install -g @call-e/cli`), running `calle auth login` (opens a browser to authorize), and
  reading the `token.access_token` field from the cached token file the CLI prints the path to
  (e.g. `~/.calle-mcp/cli/<hash>/token.json`). The token is long-lived (about 1000 days), so this
  is a one-time setup step. Never commit it — `.env*` is gitignored (except `.env.example`,
  which contains no real values).
- **`ANTHROPIC_API_KEY`** (optional, real calls only): powers the LLM extraction pass described
  in [How it works](#how-it-works). Not needed to run the app, not needed for real calls to work
  at all — the free heuristic fallback covers that — only improves extraction accuracy when set.
- **`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`** (deployed instance only, never needed locally):
  see [Netlify deployment](#netlify-deployment).
- Nothing in this repo reads credentials from anywhere other than environment variables, and
  nothing logs or displays a credential value anywhere in the app or its output.

## Cancellation & rollback

- **Cancel a specific lead before it's called:** every "pending" lead has a **Cancel** button on
  `/review` and on its own detail page. This sets it to `failed` with a
  "Cancelled by operator" summary and it will never be dispatched — implemented as the same
  atomic conditional `UPDATE` pattern as dispatch's own claim, so a cancel can't race a worker
  tick that's claiming the same lead at that instant. Once a lead reaches `in_progress` (a real
  call is actually in flight), there is nothing to cancel: CALL-E's own `run_call` contract has
  no abort/interrupt operation, and its guidance is explicit — "Do not call `run_call` more than
  once... once started, wait for activity" — so MinuteOne doesn't attempt one either.
- **Stop the recurring background job:** locally, stop the dev server process (`Ctrl+C`) — the
  poller is in-process and stops with it, nothing else to unsubscribe from. On the deployed
  instance, either delete the Netlify site, or remove/rename
  `netlify/functions/sweep-scheduled.ts` and redeploy — Netlify has no separate CLI toggle for a
  single scheduled function. Setting `DRY_RUN` back to unset/`true` stops it from placing *real*
  calls immediately, but does not stop the sweep itself from running (it'll keep dispatching
  through the fake provider).
- **Rollback a bad business-config change:** every `/setup` save is a full replace of the one
  config row — there's no version history kept in the app, but `lib/config/business.example.json`
  (the original seed) is a plain file under version control if you need to get back to the
  starting point, and can just be re-entered through `/setup`.

## Consent & safety

- **Explicit user intent, enforced twice:** the lead form's consent checkbox must be checked to
  submit at all (the intake schema requires `consent: true` literally — a request without it is
  rejected with a 400 before a row is ever created), and `dispatchLead` independently refuses to
  place a call for any lead without consent recorded, in case a row ever reached the database
  some other way.
- **E.164 phone numbers only** — validated by both the client-side input pattern and the
  server-side Zod schema (`leadIntakeSchema`).
- **Masked/example numbers everywhere in this repo** — `.env.example`, the lead-form placeholder,
  and every test/demo number use the reserved `+1555…` range. The only real number ever used
  during this build was the developer's own, for direct real-call verification, and it never
  appears in the repo.
- **No hidden recurring schedules** — see [Side effects](#side-effects); both the poller and the
  scheduled function are documented here, not discovered by reading source.
- **No duplicate jobs** — `dispatchLead`'s atomic claim (see [How it works](#how-it-works)) means
  a lead can only ever be picked up by one worker tick, not dispatched twice by two overlapping
  ones.
- **Clear cancellation behavior** — see [Cancellation & rollback](#cancellation--rollback).
- **No credential exposure** — see [Credential handling](#credential-handling).
- **Content boundaries:** the demo business config (`business.example.json`) is a fictional home
  services company asking about repair/installation/inspection requests. Nothing in this app
  generates medical, legal, financial, or emergency-services content — a real deployment's
  business config is the operator's own responsibility, same as the script a human sales rep
  would follow.

## Netlify deployment

The submission itself only needs `npm i && npm run dev` (SQLite + in-process poller, above). This
section is for the optional live demo instance, which needs a real database since Netlify
functions have an ephemeral filesystem — a local SQLite file wouldn't survive between invocations.

**Live instance:** <https://minuteone-calle.netlify.app> (dry-run). Continuously deployed from
<https://github.com/Rohree/minuteone> (`master` branch) — a `git push` there triggers a new
production build automatically, same as `netlify deploy --build --prod`.

**Two non-obvious things this needed, in case the deploy ever breaks again:**

- `package.json`'s `build` script is pinned to `next build --webpack`, not the Turbopack default.
  Turbopack's production output externalizes `@libsql/client` under a bundler-generated hashed
  module name that Netlify's function packaging can't resolve at runtime (`Cannot find module
  '@libsql/client-<hash>'`) — webpack's build doesn't have this problem.
- `lib/db/client.ts` picks between `@libsql/client` + `drizzle-orm/libsql` (native, needs a
  platform-specific binary) and `@libsql/client/web` + `drizzle-orm/libsql/web` (pure HTTP, no
  native binary) based on whether `TURSO_DATABASE_URL` is set. This isn't just about which client
  object gets used — `drizzle-orm/libsql`'s own driver module imports the *native* `@libsql/client`
  at its own top level purely to type an internal fallback, so merely importing it (regardless of
  whether that fallback path ever runs) crashes with `Cannot find module '@libsql/linux-x64-gnu'`
  on Netlify's Linux function, whose file tracing doesn't reliably bundle that platform binary.
  Both imports use `require()`, not `import`/`await import`, because the standalone Netlify
  Function bundle (`netlify/functions/sweep-scheduled.ts`, esbuild, CJS output) doesn't support
  top-level await. Also: `process.env.NETLIFY` is **not** reliable inside the deployed Next.js
  Runtime function (only during the build step) — use `TURSO_DATABASE_URL`'s presence instead to
  tell local mode from deployed mode, as `instrumentation.ts` does.

1. **Provision a Turso database** (same SQLite dialect as local dev — one Drizzle schema serves
   both). Via the [Turso dashboard](https://turso.tech) or CLI, create a database and grab its
   `libsql://...` URL and an auth token.
2. **Push the schema to it once:**

   ```bash
   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push
   ```

   The business config row seeds itself lazily on first read — no separate seed step needed.
3. **Link a Netlify site** (`netlify login`, then `netlify init` or `netlify link` from this
   directory) and set its env vars — either in the Netlify UI or:

   ```bash
   netlify env:set TURSO_DATABASE_URL "libsql://..."
   netlify env:set TURSO_AUTH_TOKEN "..."
   ```

4. **Deploy:** `netlify deploy --build --prod`, or push to a connected git remote for
   auto-deploy. `netlify.toml` wires up `@netlify/plugin-nextjs` and points
   `netlify/functions/sweep-scheduled.ts` (a 1-minute cron, the deployed-mode equivalent of the
   local poller — see `lib/worker/sweep.ts`, shared by both) at `netlify/functions`.
5. **Verify:** submit a lead on the live URL and confirm it moves off `pending` within about a
   minute on `/review`. To place real calls there too, also set `DRY_RUN=false` +
   `CALLE_API_KEY` (see [Dry-run vs real calls](#dry-run-vs-real-calls)).

## How this differs from similar apps in this repo

None of the existing `apps/typescript/` entries implement this specific pattern — an inbound web
lead calling the *business* back within about a minute, with config-driven qualification
questions scored into a routing decision. The closest neighbors, and how MinuteOne differs:

- **`ai-front-desk`** is a receptionist that keeps an appointment-business's calendar full across
  three flows; MinuteOne is a single-purpose speed-to-lead qualifier with a scored outcome, not a
  calendar system.
- **`clinic-appointment-concierge`** calls in the opposite direction — on behalf of a patient,
  outbound to a clinic — rather than a business calling back its own inbound lead.
- **`evidence-grounded-callback`**, **`recallready`**, **`readyline`**, **`dispatch-pulse`**, and
  **`verify-contact-claim`** each solve a narrow, differently-shaped problem (evidence-grounding
  guardrails, product recalls, event vendor coordination, delivery verification, and scam-number
  verification, respectively) — none are lead-qualification workflows.

## Build status

**Done and verified:**

- Full local dry-run pipeline (lead form → intake → poller → dispatch → fake provider → scoring →
  review console, including cancellation), typecheck, lint, and `next build` all pass.
- Real `calle.ts` `CallProvider` verified against a real CALL-E call end-to-end: `plan_call` →
  `run_call` → polling → a completed ~2.5-minute qualification conversation. That real call
  surfaced two bugs, both fixed and re-verified: the poll ceiling was too short for a real
  conversation (`MAX_POLL_MS` 3min → 6min), and CALL-E's real API never returns structured
  answers (only prose in `summary`/`transcript`) — `lib/call/extract.ts` (LLM pass) with
  `lib/call/extract-heuristic.ts` (free local fallback) now recover the qualification answers
  either way.
- `/setup` (business info → qualifying questions → live test form) verified end-to-end: a
  reconfigured business's opening line and custom questions immediately reflect on the home page
  and are what a real dispatched call scores against.
- Netlify deployment, live at <https://minuteone-calle.netlify.app>, continuously deployed from
  GitHub — verified end-to-end: a lead submitted via the live API lands in Turso and the
  scheduled function correctly picks it up and applies the business-hours gate.
- `scripts/validate_repository.py` run against a full clone of `awesome-phone-call-agents` with
  this app in place — passes.

**Left before submission:**

- 3-minute demo video + PR to `CALLE-AI/awesome-phone-call-agents` + Devpost submission.

Deadline: **2026-09-14**.

## Project layout

```text
app/
  page.tsx, lead-form.tsx      hosted lead form
  setup/                       business info → questions → live test wizard
  api/leads/route.ts           lead intake webhook (Zod-validated)
  api/leads/[id]/cancel/       cancel-before-dispatch endpoint
  api/config/route.ts          business-config save endpoint
  review/                      review console (list + LeadCard detail, cancel action)
components/
  business-config/             identity fields + questions builder, shared by /setup
  leads/                       shared lead-table/stats/detail, used by /review
lib/
  config/                      business config schema, example config, DB-backed loader
  db/                          Drizzle schema + client (SQLite locally, Turso when deployed)
  lead/                        lead intake / LeadCard Zod schemas, rubric scoring
  call/                        CallProvider interface, fake.ts, calle.ts, task-builder.ts,
                                extract.ts (LLM) / extract-heuristic.ts (free fallback)
  worker/                      dispatchLead core (atomic claim), business-hours check, poller
instrumentation.ts              starts the local poller once per server instance
```
