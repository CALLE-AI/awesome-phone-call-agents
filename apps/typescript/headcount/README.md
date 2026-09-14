# Headcount

The phone version of CDC CASPER. After a disaster, a duty officer needs to know
**who was not reached** — `voicemail_left` is not a reach. The denominator is
the product.

Headcount is a Next.js EOC console that runs a one-shot household needs
assessment over CALL-E. Wave 1 dials an opt-in roster. Coverage is
`dialed / reached / unaccounted`. Unsupported model claims strike through.
Medical emergency, trapped, or an unsupported critical field fail closed to a
human dispatch card — never auto-resolved.

Provider: **CALL-E** (`@call-e/calle` 0.7). Host: local Next.js. English only.
Default path is fixture replay. Live calling is opt-in.

Contribution area: **User-facing Apps**. Path: `apps/typescript/headcount`.

## For judges (fast path)

No API key. No live call. Node 20+.

```bash
cd apps/typescript/headcount
cp .env.example .env
npm install
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You land on the Bennett
Valley fire CASPER drill with an empty coverage board and 12 opted-in
households.

1. Confirm **Wave 1**. Live tracks fill. Kill switch is in the header.
2. Watch the coverage bar. Voicemail and no-answer sit in **Unaccounted**.
3. Open a completed household. Unsupported fields are struck through.
4. Play **Call reel** and **Coverage reel** — they render the same JSON the
   board used.
5. Hit **Kill switch** mid-wave on a second run (`npm run db:seed` first).
   Queued attempts become `cancelled` → Unaccounted.

After-action screenshot board (still no live calls):

```bash
npm run db:seed:after
```

Offline checks:

```bash
npm test
npm run typecheck
```

`npm test` asserts the taxonomy rule: voicemail is not reached.

## What it is not

Not a campaign runner. Completions are not the headline.
Not an ongoing wellness check (`metapelet-elder-checkin`, `kincall`).
Not a shift fill (`mobilize`, `standby`).
Not an emergency service. The agent never gives medical, evacuation, or safety
advice and never promises a response time.

## How a wave works

1. The instrument compiles to verbatim task text. Judges can read it on
   **New wave** before Confirm.
2. Region, locale, and IANA timezone are stored per roster row. They are never
   inferred from the phone number.
3. The idempotency key is `hc:{event_id}:{roster_entry_id}:{wave_no}:{instrument_version}`.
   Re-confirming the same wave is a no-op.
4. Wave 2 retries only `RETRYABLE` dispositions (`no_answer`, `voicemail_*`,
   `ivr_dead_end`) plus `needs_assistance`.
5. Evidence linker scores each structured field against user turns. A field
   with `supported: false` is a claim, not a fact.

Fail-closed → human card:

- `safety_status == medical_emergency`
- `evacuation == trapped`
- `needs_human == yes`
- low completion confidence on a critical field
- any unsupported critical field

## Dry-run / fixture (default)

`CALLE_LIVE` is not `1`. Confirm Wave plays scripted personas from
`vendor/sim/fixtures` (cooperative, voicemail, partial, emergency,
wrong-person, hostile, unsupported claim, no-answer). No CALL-E credit. No
ring. Seed phones are reserved fictional NANP `555` numbers
(`+15555550101` …) and render masked (`+1 555 ••• ••01`).

The header meter shows remaining budget against a project cap of 20 and labels
the mode **fixture**.

## Live calling (opt-in)

The console stays on fixtures so judges can run the product without spending
calls. A real CALL-E create is available from the vendored client:

```bash
CALLE_LIVE=1 CALLE_API_KEY=iams_live_... CALLE_SMOKE_PHONE=+1XXXXXXXXXX npm run smoke
```

`smoke` refuses to run live against a `+1555` number or a placeholder key.
Region `US` and locale `en-US` are passed explicitly. The smoke task
identifies as automated AI and collects no personal data.

Side effects of a live smoke: one outbound CALL-E call, CALL-E credit, a real
phone rings. Use your own number.

## Cancellation

There is no recurring scheduler. Nothing runs unattended.

**Kill switch** (header, every screen) blocks new dials and cancels in-progress
fixture attempts (`cancelled` → Unaccounted). It cannot remotely hang up a
CALL-E call that already started. For a live smoke that has already been
accepted, use the [CALL-E dashboard](https://dashboard.heycall-e.com).

Stopping `npm run dev` stops fixture finalization. It does not roll back a
completed assessment.

## Credentials

Copy `.env.example` to `.env`. Do not commit `.env`. Keys stay on the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CALLE_LIVE` | `0` | Set `1` only for `npm run smoke`. |
| `CALLE_API_KEY` | `sim-local` | Required for live smoke. |
| `CALLE_BASE_URL` | `http://localhost:4000` | Simulator. Live smoke uses `https://api.heycall-e.com` when `CALLE_LIVE=1`. |
| `CALLE_SMOKE_PHONE` | unset | Your E.164 number. Required for live smoke. |

## Safety

See [`SAFETY.md`](./SAFETY.md). Short version: AI disclosure on the first turn,
roster is opt-in, voicemail leaves a callback and asks no questions, kill is
first-class, numbers are masked, medical/legal/emergency advice is out of
scope.

## Layout

```text
src/app/            Coverage, roster, new wave, call report, instrument
src/lib/            Wave runner, evidence triage, instrument compiler
vendor/core/        Dispositions, idempotency, budget, evidence, CALL-E client
vendor/sim/         Persona fixtures (and optional local fake server)
vendor/reel/        Remotion CallReel + CoverageReel
```
