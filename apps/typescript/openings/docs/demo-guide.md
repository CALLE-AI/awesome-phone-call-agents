# Openings — Hackathon Demo Guide

Demo for **CALL-E: Your Code Is Calling**. Target: the **Most Practical Use Case**
prize. The demo is a ~3 minute video plus a deployed instance judges can click.

One-line pitch, memorize it:

> **Provider directories are wrong about two-thirds of the time — so Openings calls
> the practices that are actually listed, verifies who is real, who takes your plan,
> and who has a slot, then keeps watching until one opens.**

---

## Demo modes (decide before recording)

| Mode | When | What you get |
| --- | --- | --- |
| **Live** (recommended for the video) | You have a `CALLE_API_KEY` + business hours | Real verdicts incl. ghosts and evidence quotes — the money shot |
| **Dry-run** (default) | No credentials; safe judge sandbox | Full flow, but every outcome is simulated-*open* — no ghosts |

> ⚠️ In dry-run every call returns `open`, so the ghost reveal **requires live mode**.
> If you record the video in dry-run, the ghost moment cannot happen — record the
> ghost segment over a pre-run live watch (see "Two-take recording" below).

---

## Setup checklist (before recording)

```bash
cd apps/typescript/openings
pnpm install
pnpm check          # typecheck + lint + tests — must be green
```

Rehearse locally in dry-run:

```bash
cp .env.example .env.local
pnpm dev            # OPENINGS_CALL_MODE=dry-run by default
# open http://localhost:3000
```

For the live recording:

```bash
# .env.local:
OPENINGS_CALL_MODE=live
CALLE_API_KEY=your_key_here
```

Recommended live demo config:

- **Location:** `Philadelphia, PA` (proven path; run during US business hours, ~9–11am ET)
- **Specialty:** `Psychiatry`
- **Plan:** `Aetna PPO`
- **Need:** `adult ADHD evaluation`
- **Max calls per run:** `5` (live calls take 1–4 min each in IVR/hold)

A quick live batch before the main take:

```bash
OPENINGS_LIVE_TESTS=1 pnpm test
# or the guided runner:
pnpm verify:live    # frames Philadelphia, dials a 5-call sample, prints verdicts,
                    # records ghosts, prints the watch id + db path
```

---

## Two-take recording (recommended)

Live calls are slow. Do not try to show verdicts appearing in real time.

1. **Take A (before recording):** run a live watch (UI "Run now", or `pnpm verify:live`)
   and let it complete. You now have a watch page with real verdicts and a `/reports`
   page with real ghost facts.
2. **Take B (the video):** narrate over the completed live watch + reports page, and use
   a **fresh dry-run watch** only to demonstrate the form and the instant flow.
   Narrate honestly: *"here's the flow… and here's a real run we did earlier."*

Skip Take A entirely if you are confident a single live run will finish during the take.

---

## The 3-minute script

Timing assumes ~150 spoken words/minute. Keep it tight; every word counts.

### 0:00–0:25 — Hook (screen: home page)

> "This is Openings. When you need care, you don't need a directory — you need a slot
> that actually exists. Provider directories are wrong about two-thirds of the time:
> in a 2025 study of 8,300 behavioral-health providers, 56% had a wrong phone number,
> and only one in seven actually had an opening. The only way to know the truth is to
> pick up the phone. So that's what this does — it calls."

### 0:25–0:55 — The form (screen: fill the form)

> "I want adult ADHD evaluation on Aetna PPO in Philadelphia. I pick the specialty
> explicitly — we never guess which kind of practice to call — and I cap each run so
> cost stays bounded. Every request is screened first: crisis language stops the search
> and points to 988, and we never collect diagnosis or medication details, so no
> protected health information ever touches the phone call."

*Optional 5-second beat:* type `thinking about suicide` → show the amber block → clear it.

### 0:55–1:35 — Run + results (screen: watch page verdicts)

> "Start watching. Openings frames the practices that are actually listed — from the
> federal NPPES registry, so every number has provenance, none is synthesized — then
> dials them one at a time, re-checking cancellation before every call. Each call identifies itself as an automated assistant and asks
> one thing: do you take this plan, and do you have a slot? Here's a real run: open…
> waitlist… not accepting… and this one is a ghost. The directory listed it; the phone
> says disconnected. That's now a verifiable fact, evidence quote included."

### 1:35–2:10 — Reports + watch cadence (screen: `/reports`, then watch page)

> "Dead lines accumulate into an access report — facts proven by calls, not claims.
> And if nothing opens, Openings keeps watching: re-calling on a decaying cadence —
> one hour, three, seven, then daily, then weekly — until a slot opens, or I stop it.
> Cancellation is first-class: Stop, and it is never re-run. Every practice is called
> at most once a day, and never again once it opts out."

### 2:10–3:00 — The tech (screen: `pnpm verify:live` terminal output or a snippet of code)

> "Under the hood, recurrence lives on the host: the scheduler triggers exactly one
> CALL-E call per run, using the published SDK. Every call uses a strict result schema
> with an evidence quote and a stable idempotency key, so retries never double-book.
> The verdict — open, ghost, unreachable — is computed locally by a pure, unit-tested
> classifier; a voicemail is never upgraded to 'open'. That's a watch that verifies the
> directory against reality, and stops the moment you have a slot. Openings."

---

## What to say about the tech (if asked)

Keep these answers to one or two sentences each:

- **"Where is CALL-E actually used?"** — `@call-e/calle` is imported and called at
  runtime in `src/core/calle.ts` via `createAndWait`, with a strict `result_schema`
  and a stable idempotency key.
- **"How do you know a verdict is true?"** — verdicts are computed by a pure,
  unit-tested classifier in `src/core/classify.ts`. Unknown is never upgraded: a
  voicemail is `unreachable`, never `open`. Every verdict carries an evidence quote.
- **"How is the recurrence safe?"** — the host owns scheduling (the repo's Design
  Principle 1): one CALL-E call per scheduled run. No provider-side recurrence.
- **"What bounds the blast radius?"** — a hard per-run call cap, a 24h cooldown per
  practice, permanent opt-out, and Stop (a stopped watch is never re-run).
- **"Is there PHI?"** — no. The task only asks about plan acceptance and availability;
  the form rejects diagnosis/medication language before anything runs.

---

## Anticipated judge questions

1. **Why not just query a directory API?** — Directories are wrong 65% of the time
   (wrong numbers, dead lines). The phone call *is* the verification.
2. **What if nobody answers?** — Classified `unreachable` with the CALL-E summary,
   re-called on the decay cadence inside the 24h cooldown. Silence is never read as an opening.
3. **Cost?** — a fraction of a cent to a few cents per call, capped per run, and the
   sequential dispatcher stops the moment the target is met.
4. **Who is this for?** — anyone navigating a marketplace directory: individuals, care
   coordinators, navigators, and employers running an access scan.
5. **Why NPPES?** — it is the federal directory with provenance for every number; we
   surface its staleness as a feature (`sourceUpdatedAt`) and verify by phone.
6. **Medical boundaries?** — Openings never books, never gives medical advice, only
   reports plan acceptance and availability; crisis language diverts to 988.

---

## Recording tips

- Full-screen browser, 1080p, hide bookmarks bar. Record the *app*, not your setup.
- **Mask phone numbers** in the final edit if you prefer (they are public directory
  listings; blurring avoids anyone hunting the practices).
- Never show `CALLE_API_KEY`, `.env`, or the terminal containing secrets.
- If a live call lands off-hours, embrace it: an `unreachable` result with the summary
  "call back Monday 9am" is an honest, on-message moment.
- Voice the recording after the fact if you need clean audio. Keep total spoken words
  under ~450.

---

## Deploy a clickable sandbox (optional but valuable for judges)

The `Dockerfile` + `fly.toml` deploy the server and scheduler together, SQLite on a
persistent volume:

```bash
fly launch --no-deploy
fly volumes create openings_data --size 1 --region sin
fly secrets set OPENINGS_CALL_MODE=dry-run   # judges can click without spending credits
fly deploy
```

Keep the sandbox in **dry-run** (safe to click) and show the live run only in the video.

---

## Devpost submission

1. Open a PR to `CALLE-AI/awesome-phone-call-agents` (branch `feat/openings-app`),
   including the root README Apps-table entry. Keep `opencode.json` out of the PR.
2. Video: public YouTube/Vimeo, ~3 min, link on the submission form.
3. CALL-E account email on the form.
4. Optional: the deployed demo URL.
5. Short description (reuse the one-line pitch).

Submission checklist passes when: `python3 scripts/validate_repository.py` is green on a
clean clone, and `pnpm check` is green in the app.
