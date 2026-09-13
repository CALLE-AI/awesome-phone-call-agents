# Openings — Devpost Submission

**Project:** Openings — a standing availability watch for care access
**One-liner:** Openings repeatedly calls the healthcare providers actually listed in directories to verify who is real, who takes your insurance, and who has an opening — then keeps watching until one opens.

---

## Inspiration

Provider directories are wrong about two-thirds of the time. A 2025 secret-shopper study of the Pennsylvania ACA marketplace (8,306 behavioral-health providers) found that **65.2%** of verifiable listings had at least one inaccuracy, **56.6%** had a wrong phone number, and appointments were actually available for only **14.9%** of listed providers. When you need care, a directory tells you to dial twenty numbers to find one real opening.

Directory data cannot be trusted — only a phone call establishes the truth. That was always true, but it was too expensive to do at scale. CALL-E changes the economics: at a few cents a call, dialing every listing — and re-dialing until a slot opens — is affordable for the first time. So we built Openings, a **standing availability watch** for care access.

## What it does

Openings takes the care you need, your insurance plan, your city, and a specialty, then calls the practices that are *actually listed* — not a database — to verify who is real, who takes your plan, and who has an opening. If nothing is open, it keeps watching until a slot appears, then stops.

1. **Frame** — builds the candidate list from the federal NPPES NPI Registry (by specialty and city/state). Every number carries provenance; none is synthesized.
2. **Gate** — screens the request for crisis language (diverts to 988) and for PHI (rejected; the app never collects a diagnosis or medication details, so no protected health information ever touches the phone call).
3. **Verify** — dials practices strictly one at a time (cancellation checked before every call) and stops the moment the target number of openings is confirmed. Each call identifies itself as an automated assistant and asks only two questions: *do you accept this plan, and do you have an opening?*
4. **Watch** — when nothing is open, the host scheduler re-calls on a decaying cadence until an opening appears or the user stops it.

Every call returns a verdict with a verbatim evidence quote and CALL-E's post-call summary, so nothing is taken on faith. Dead and misrouted lines accumulate into a verifiable **access report** — facts proven by calls, not by claims.

## How we built it

- **Next.js 15** (App Router + server actions), **TypeScript**, **React 19**, **SQLite** (WAL), **Tailwind CSS**.
- **CALL-E SDK** (`@call-e/calle`) via `createAndWait`, with a strict result schema — enums that include `unknown` plus a required `evidence_quote` — stable idempotency keys, and a 6-minute timeout so calls can survive IVR/hold.
- **Local, pure classifier.** Verdicts are computed by a unit-tested pure function, never in the prompt. `unknown` is never upgraded to a confident verdict.
- **Host-owned recurrence** (the CALL-E community's Design Principle 1): a separate scheduler process triggers exactly one CALL-E call per scheduled run; the provider is never asked to recur.
- **Safety as a first-class layer:** E.164 normalization, a 24-hour cooldown per practice, permanent opt-out, and a hard per-run call cap so cost and blast radius are always bounded.

## Challenges we ran into

1. **Real calls are slow.** A call spends 1–6 minutes in IVR/hold, so a synchronous "Run now" server action blocked the request until the browser dropped the connection (EOF). We moved dispatch to a background job with client-side polling and a live "calling" state.
2. **Honest classification is hard.** We had to distinguish *reached a human but got no answer* (inconclusive) from *no one answered* (unreachable) from *the directory lied* (ghost) — a human saying "How can I help you?" is not the same as a voicemail.
3. **Two processes, one container.** Running the Next.js server and the scheduler together over one SQLite file worked, until an `unref()`'d scheduler timer left an empty event loop — the scheduler exited instantly and `wait -n` took the whole container down.
4. **Directory rot is the product.** NPPES's `enumeration_type` was silently discarding organizations (NPI-2), and the specialty filter had to be a closed, explicit choice — inferring it from free text would mean dialing the wrong kind of practice.

## Accomplishments that we're proud of

- **An honest classifier.** Unknown is never upgraded to a confident verdict; "reached a human, no answer", "no one answered", and "the directory lied" are three distinct outcomes, each with an evidence quote behind it.
- **A "keep calling until it opens" product that stays safe.** The 24-hour cooldown, permanent opt-out, per-run call cap, and host-owned recurrence keep it a feature instead of a nuisance.
- **A test suite you can run blind.** 54 tests pass with no credentials, no network, and no native-module build; live calls are strictly opt-in.
- **Verified live, end to end.** Real calls to Philadelphia psychiatry practices produced honest verdicts and an access report — including ghost listings — not a scripted demo.

## What we learned

The big one: **structured results with an evidence quote beat prompt-based judgment.** When the model has to commit to a schema (`line_outcome`, `accepts_plan`, `accepting_new_patients`, a quoted `evidence_quote`), the system can classify honestly and show its work. The decaying watch is a simple idea with sharp edges — cooldowns, opt-outs, and a per-run cap are what keep it from becoming harassment.

## What's next for Openings

- **More sources, more specialties.** Frame from multiple directories (not just NPPES) and add a consent-gated paste/CSV import.
- **Alert the human when a slot opens.** SMS/email notifications, and a booking handoff (Openings never books on the caller's behalf).
- **Business-hours-aware scheduling.** Call practices during their timezone's business hours instead of whenever the watch ticks.
- **Supply-side directory health.** The accumulated access report is data payers, health systems, and state marketplaces want but don't have.
- **Navigator/employer tier.** Multi-user accounts, scheduling integrations, and HIPAA hardening for care-coordination teams.

---

## Built with

`nextjs` `typescript` `react` `nodejs` `call-e` `call-e-sdk` `sqlite` `better-sqlite3` `tailwindcss` `zod` `vitest` `esbuild` `pnpm` `docker` `flyio` `nppes-npi-registry` `server-actions` `app-router` `ai-agents` `healthcare`

---

## Pre-existing?

Built from scratch for this hackathon. It lives in the community reference repository (`apps/typescript/openings`) alongside other CALL-E apps, and follows that repo's shared safety and scheduler conventions.

---

## Testing instructions

**Live demo (no setup):** https://openings.fly.dev/ — pick a specialty, plan, and city, then press **Run now**. The app places real calls (they take a few minutes); the page shows a "calling" state and refreshes automatically when results land. Try **Psychiatry + Philadelphia, PA** during US business hours for the clearest signals.

**Local, no credentials, no calls (default):**

```bash
cd apps/typescript/openings
pnpm install
pnpm check        # typecheck + lint + 54 tests — no network, no credentials
pnpm dev          # dry-run mode: deterministic simulated outcomes, no dialing
```

**Real-call verification (opt-in):**

```bash
OPENINGS_CALL_MODE=live CALLE_API_KEY=... pnpm dev
# or, for a 5-call Philadelphia access report with printed verdicts:
pnpm verify:live
```

Safety notes: every call identifies itself as an automated assistant, asks only plan-acceptance and availability, honors a 24h per-practice cooldown and permanent opt-out, and each run is capped at `maxCallsPerRun` calls.

---

## Primary use case

**Appointment scheduling** — finding and verifying available appointments (the app discovers openings but never books on the caller's behalf).

## In one sentence

Openings repeatedly calls the healthcare providers actually listed in directories to verify who is real, who accepts your insurance, and who has an opening — then keeps watching until one opens.
