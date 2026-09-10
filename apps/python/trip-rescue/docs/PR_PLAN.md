# PR plan: submitting to CALLE-AI/awesome-phone-call-agents

The hackathon requires a PR against the official repo as part of submission. This repo's own contribution conventions (seen across `apps/python/metapelet-checkin`, `apps/python/sentinelcall-anc-followup`, etc.) put each entry under `apps/<language>/<project-name>/` as a self-contained app with its own README, tests, and `.env.example`. Trip Rescue follows that layout exactly, so the PR is close to a straight copy.

## Steps (requires your own GitHub account — I can prepare everything up to the push, but forking, pushing, and opening the PR needs your GitHub credentials at the keyboard)

1. Fork `https://github.com/CALLE-AI/awesome-phone-call-agents` to your own GitHub account.
2. Clone your fork locally (or in this workspace, if you'd rather do it from here).
3. Copy this entire `trip-rescue/` directory to `apps/python/trip-rescue/` in your fork (drop the `.venv/` and `.pytest_cache/` directories — they're git-ignored, no need to copy them).
4. Commit: `git add apps/python/trip-rescue && git commit -m "Add Trip Rescue: proactive flight-disruption rebooking via CALL-E + Duffel"`.
5. Push to your fork and open a PR against `CALLE-AI/awesome-phone-call-agents:main`.
6. Copy the PR URL into the Devpost submission form (see `SUBMISSION_DRAFT.md`).

## What to double check before opening the PR

- [ ] `.env` is not committed (it's git-ignored; only `.env.example` should be tracked).
- [ ] `python -m pytest tests/ -v` passes clean (17/17 as of this build).
- [ ] `python scripts/simulate_disruption.py` runs in dry-run with no environment variables set.
- [ ] The README's live-mode instructions are accurate for whatever CALL-E/Duffel account you submit under (the email tied to your CALL-E account is a required submission field).

## Recording the demo video (under 3 minutes, judges aren't required to watch past that)

Suggested cut, given the two things that actually demo well are the phone call itself and the price/time changing live on the Duffel side:

1. (~15s) One sentence on the problem: cancelled flights get discovered by the traveler, not fixed for them.
2. (~10s) Show the booked trip (order + booking reference) already in place.
3. (~15s) Trigger the disruption (`simulate_disruption.py` or an equivalent button/UI if one gets built) — say out loud that this step stands in for a live airline feed, per the README's stated limitation. Judges respond better to an honest "here's the one thing we didn't have API access to in 4 days" than to an implied claim that isn't true.
4. (~60-90s) The actual CALL-E phone call, ideally played live or as a clean recording — this is the moment worth spending the most time on.
5. (~20s) Show the Duffel order updated: new departure time, new total, same booking reference.
6. (~10s) Close on the one-line pitch and where this goes next (OTAs/TMCs, not directly to airlines — see README's Go-to-market section).
