# Vouch

Consent-scoped employment verification. **No consent artifact, no dial.** There
is no override in the UI for missing, revoked, or expired consent.

Vouch is a Next.js verification console. A requester asks for fields. The
scope compiler keeps only `requested ∩ consent`, then subtracts jurisdiction
blocks — California SB 1162 strips `salary_history` even when the form
included it. Confirm is disabled until the gate passes. The agent may ask
only the permitted set. Third-party-only is a first-class disposition, not a
collapsed fail.

Provider: **CALL-E** (`@call-e/calle` 0.7). Host: local Next.js. English only.
Employment and education only. Default path is fixture replay. Live calling
is opt-in.

Contribution area: **User-facing Apps**. Path: `apps/typescript/vouch`.

## For judges (fast path)

No API key. No live call. Node 20+.

```bash
cd apps/typescript/vouch
cp .env.example .env
npm install
npm run db:seed
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). Three seeded consents:

| Candidate | What to look at |
| --- | --- |
| **Alex Rivera** | Requested vs permitted. Salary history struck — California SB 1162. Confirm is enabled. |
| **Sam Cole** | Confirm, then third-party gatekeeper. Disposition is `gatekeeper_refused`, not a generic fail. |
| **Jordan Hale** | Consent revoked. Confirm is disabled. No override. |

1. Open Alex Rivera. Read the two-column scope diff, then the compiled task.
   Salary is not in the task string.
2. Confirm. The board polls; the run flies to **Confirmed**.
3. Open the run. Unsupported fields strike through. Play **Scope reel** and
   **Call reel**.
4. Open Jordan Hale. Confirm stays disabled.
5. Kill switch is in the header on every screen.

Offline checks:

```bash
npm test
npm run typecheck
```

## What it is not

Not a claim verifier that cannot prove it was allowed to ask
(`verity-verification-core`, `verify-by-phone`, `hirecall`).
Not a background-check product. Criminal, credit, medical, disability, and
performance questions stay out — those are database lookups, not phone work.

## How a dial is authorized

1. Consent gate runs in code before enqueue: missing / revoked / expired →
   hard block.
2. Scope compiler: requested ∩ consent fields, minus jurisdiction blocks.
   A field absent from the permitted set cannot reach the task string.
3. Idempotency key is
   `vo:{consent_id}:{employer_id}:{field_set_hash}:{scope_version}` —
   derived from the authorization, not the attempt. Re-confirm is a no-op.
4. The compiled task identifies as an automated verification assistant,
   cites the written authorization date, and asks the speaker's name, role,
   and authority before recording answers.
5. If verification is third-party-only, the agent records that and ends. No
   persuasion.

`verifier_authority` is first-class: we record not just what was said but
whether the speaker claimed standing to say it.

## Dry-run / fixture (default)

`CALLE_LIVE` is not `1`. Confirm replays `hr_confirm` or `third_party`
scripts. No CALL-E credit. No ring. Seed numbers are masked fictional
display values (`+1 707 ••• ••40`). The header meter shows remaining budget
against a project cap of 20 and labels the mode **fixture**.

## Live calling (opt-in)

The console stays on fixtures so judges can run the product without spending
calls. A real CALL-E create is available from the vendored client:

```bash
CALLE_LIVE=1 CALLE_API_KEY=iams_live_... CALLE_SMOKE_PHONE=+1XXXXXXXXXX npm run smoke
```

`smoke` refuses to run live against a `+1555` number or a placeholder key.
Region `US` and locale `en-US` are passed explicitly.

Side effects of a live smoke: one outbound CALL-E call, CALL-E credit, a real
phone rings. Use your own number.

## Cancellation

There is no recurring scheduler.

**Kill switch** blocks new confirms and cancels in-progress fixture runs.
It cannot remotely hang up a CALL-E call that already started. For a live
smoke that has already been accepted, use the
[CALL-E dashboard](https://dashboard.heycall-e.com).

Revoking consent (Jordan Hale in the seed) is the product-level rollback:
Confirm stays disabled. A completed run is not unwritten.

## Credentials

Copy `.env.example` to `.env`. Do not commit `.env`. Keys stay on the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CALLE_LIVE` | `0` | Set `1` only for `npm run smoke`. |
| `CALLE_API_KEY` | `sim-local` | Required for live smoke. |
| `CALLE_BASE_URL` | `http://localhost:4000` | Simulator. Live smoke uses `https://api.heycall-e.com` when `CALLE_LIVE=1`. |
| `CALLE_SMOKE_PHONE` | unset | Your E.164 number. Required for live smoke. |

## Safety

See [`SAFETY.md`](./SAFETY.md). Short version: no consent artifact, no dial;
salary history never asked in California; employment and education only;
numbers masked; kill is first-class.

## Layout

```text
src/app/            Board, consent/scope, run report
src/lib/            Consent gate, scope compiler, runner
vendor/core/        Dispositions, idempotency, budget, evidence, CALL-E client
vendor/reel/        Remotion ScopeReel, VerificationReel, CallReel
```
