# ChangeLock

An accounts-payable fraud command center. When a vendor asks to change where payments
are sent, ChangeLock holds the request, calls the vendor's **pre-existing trusted
contact** with CALL-E to ask one bounded question — *did your organization initiate
this change?* — and records the call as evidence for a human analyst.

It never approves, applies, or executes a payment change. Confirmed is evidence,
not authority.

Contribution area: **runnable app** — `apps/typescript/changelock`, submitted for
**CALL-E: Your Code Is Calling**. Built with Next.js, React, TypeScript, SQLite,
and the `@call-e/calle` SDK.

## Safety properties

- **Explicit intent**: a real call requires the typed phrase `VERIFY <SAFE_CASE_CODE>`
  plus an operator attestation that the dialed number belongs to a consenting
  contact in the vendor master record.
- **E.164 + consenting allowlist**: live mode dials only valid E.164 numbers that
  appear in `CHANGELOCK_LIVE_CONTACT_ALLOWLIST` and a region allowlist.
- **Masking**: only masked phone numbers reach the browser, audit log, or
  persistence; full numbers stay server-side.
- **No credentials exposed**: `CALLE_API_KEY` is server-only and is never read in
  replay mode; a repo scan (`npm run verify:no-secrets`) blocks leaked keys.
- **One call, no schedules**: each authorization produces at most one call intent.
  There are no recurring jobs, background pollers, or automatic retries; a call is
  "cancelled" simply by never dispatching, and ambiguous submissions escalate to a
  human rather than redial.
- **No duplicates**: every intent carries a content-bound idempotency key; the
  same call cannot be created twice.
- **Financial boundary**: the app cannot update vendor banking data, release an
  invoice, or authorize a payment — the change request stays `held` permanently.

## Why

Business email compromise and vendor bank-detail fraud cost billions a year. The
control auditors recommend is an out-of-band phone call to a number already on
file — not the number in the request. ChangeLock automates exactly that call, and
nothing else.

## Run it

```bash
npm install
npm run db:seed   # optional; the app seeds itself on first run too
npm run dev       # or: npm run build && npm start
```

Open http://localhost:3000. Four fictional cases are seeded. No credentials or
environment variables are needed — the app runs in **judge replay mode** by
default and cannot place a live call.

In a case workspace, pick a replay scenario, type the exact phrase
`VERIFY <SAFE_CASE_CODE>`, tick the attestation, and submit. The scenario result
flows through the same normalization, closed-schema parsing, and policy gates a
live CALL-E result would.

## The trust boundary

- The callback number in the request is treated as **attacker-controlled** and is
  never dialed. It is masked and stored as metadata only.
- The only number ChangeLock will ever dial is resolved server-side from
  `trustedContactId` against the vendor master record.
- Dispatch accepts only an `intentId`. Phone, task, schema, and provider mode are
  loaded from storage — nothing in the request body can steer a call.
- The intent (task text, contact, versions, destination fingerprint) is reserved
  and hashed **before** any provider I/O. The idempotency key is content-bound.

## The call contract

The agent discloses it is automated, names the buyer and vendor, states the safe
case code, asks the single yes/no question, forbids bank details, credentials,
and OTPs, stops on refusal, and states plainly that no change is approved. The
recipient result is a closed schema — any extra or malformed field fails closed.

## Dispositions

Confirmed and denied both require every gate: binding checks (call id, intent,
request hash, versions, destination fingerprint), terminal completed status,
schema-valid result, identity confirmed, safe case code confirmed, no sensitive
data, no opt-out, an answered change status, confidence ≥ 0.70, and evidence
present. Anything else — unreachable, unable to verify, refusal, sensitive-data
disclosure, malformed result — routes to `needs_human` or stays unverified. The
payment change stays `held` in every outcome.

Ambiguous provider acceptance moves the case to `submission_unknown` and never
auto-retries. Manual refresh can only poll an already-bound call id. In live
mode the operator can reconcile by entering the CALL-E call id from the
provider dashboard — the result is re-bound and re-evaluated only if every
binding check passes, otherwise the case moves to `needs_human` unbound — or
escalate directly to human review.

## Live mode (not required for judging)

Live operation is local-only: the supplied dev/start commands bind to `127.0.0.1`.
Do not tunnel or reverse-proxy live/private routes without adding operator authentication.
The public Docker command forces replay mode and removes the provider key from its process.

`CHANGELOCK_MODE=live` plus `CALLE_API_KEY` and nonempty comma-separated
`CHANGELOCK_LIVE_CONTACT_ALLOWLIST` (consenting E.164 numbers) and
`CHANGELOCK_LIVE_REGION_ALLOWLIST` (e.g. `US`) enables the real `@call-e/calle`
SDK adapter (`calls.create` with the reserved idempotency key; `calls.get` for
refresh and reconciliation). Live authorization refuses before reserving unless
the trusted contact's number and region are both allowlisted; without all of
these, live dispatch refuses before any network I/O. Public/judge code paths
only ever construct replay intents.

## Public deployment

### Vercel + Turso

Deploy the repo on Vercel with framework defaults (no `vercel.json` needed) and
set three server-side environment variables:

```
CHANGELOCK_MODE=replay
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=
```

(`TURSO_AUTH_TOKEN` takes the real token in the Vercel dashboard — never in the
repo.)

`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` select a remote Turso database over
the `@tursodatabase/serverless` driver — required because `@libsql/client`'s
SQL-over-HTTP path does not support concurrent writes on Turso. The token is
required, never logged, and never exposed to the browser; the local file driver
(`@libsql/client`) is only loaded when the Turso variables are absent, so the
remote runtime never touches native SQLite bindings. On first request the app
migrates and seeds the four fictional cases into Turso; initialization is
idempotent and race-safe across concurrent cold starts. That state persists
across deploys and instances — the demo contract relies on the replay-only
`Reset synthetic case` action (visible on eligible terminal cases) rather than
on state being wiped.

### Docker (local file)

```bash
docker build -t changelock .
docker run -p 3000:3000 changelock
```

The image runs only judge replay mode: `CHANGELOCK_MODE=replay` is baked in and
no `CALLE_API_KEY`, Turso variables, or live allowlists exist inside it, so a
public deployment is structurally replay-only. Without Turso env vars the app
uses a local libSQL file at `/data/changelock.db`; on a fresh container the app
re-seeds the four fictional demo cases automatically. `render.yaml` deploys the
same image as a free web service with health check `/` and no disk — on that
ephemeral filesystem, restarts simply re-seed.

Locally, `CHANGELOCK_DB_PATH` picks the file location (default
`./data/changelock.db`); `npm run db:migrate` and `npm run db:seed` work against
whichever target `openDatabase` selects.

## Verification

```bash
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm test                 # unit + integration behavior tests
npm run build
npm run verify:no-secrets
```

## Honest limitations

Demo-grade. Fictional vendors only; no real-vendor onboarding, no RBAC/SSO, no
multi-tenancy, no webhooks (manual refresh instead), no transcript persistence.
Not a payment approval system and never will be.
