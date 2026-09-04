---
name: bounty-hotline
description: Watch a live feed of GitHub bounty-labeled issues, filter farm spam by dollar amount, repo credibility and freshness, and place a real CALL-E phone call to the developer when a worth-answering bounty appears. Includes an audit log and dedupe so the phone rings once per bounty.
license: MIT
---

# Bounty Hotline

Use this skill when the user wants to be **phoned** when a real, fresh, paid GitHub bounty appears — instead of refreshing issue trackers or drowning in notification spam.

`bounty-hotline` is a feed-watch + filter + one-off-call skill. It wraps the existing one-off CALL-E call workflow in a watch loop owned by the client (cron, launchd, or any scheduler). Every filtering decision and every call is written to an audit log.

## When To Use

Use this skill for:

- "call me when a real bounty shows up on GitHub"
- alerting freelancers to fresh paid issues while filtering duplicate "$9k" farm spam
- any watch-feed → filter → real outbound call pipeline that must stay silent unless a threshold passes

## When Not To Use

Do not use this skill to:

- call third parties who did not consent to receive calls
- guess phone numbers, country codes, timezones, languages, or regions
- place a call without a valid region-bound `HOTLINE_PHONE` and explicit per-run confirmation
- spam the recipient: one call per bounty key, ever (dedupe is mandatory)
- run without an audit log — if it isn't logged, it didn't happen

## Filters (silence is a feature)

A bounty triggers a call only when ALL pass:

1. parsed amount ≥ threshold (default `$150`, env `HOTLINE_MIN_USD`)
2. repo credibility grade A or B (stars, age, activity via GitHub API, 6h cache)
3. issue age is known and younger than `HOTLINE_MAX_AGE_H` (default 48h)
4. issue key never called before (dedupe state file)

## Core Workflow

1. Confirm the user explicitly wants bounty calls and collect:
   - E.164 destination phone number (`HOTLINE_PHONE`), bound to the operator's own region (`HOTLINE_REGION`)
   - optional thresholds (`HOTLINE_MIN_USD`, `HOTLINE_MAX_AGE_H`)
2. Resolve the CALL-E CLI using the bootstrap documented in the `call-reminder` skill, or install once via `npm install -g @call-e/cli`.
3. Run the watch loop:
   - `python3 hotline.py --dry-run` to preview filter decisions without dialing
   - `python3 hotline.py --yes --once` for cron, or `--yes --loop` for a daemon (`--yes` = per-run live-dialing consent)
4. On a passing bounty the skill follows the documented plan-confirmation flow:
   - builds a concise reading-order narration (repo, issue number, title, amount)
   - calls `calle call plan` with `--to-phone`, goal text, language and explicit region; proceeds only when the plan is `ready_to_run` and returns both `plan_id` and `confirm_token`
   - calls `calle call run --plan-id … --confirm-token …`; treats a non-zero exit or refused run as a failure, and `call_started: "unknown"` as an unrecoverable-by-retry outcome to finish through `calle call recover`
   - marks a bounty as called only after the run returns a `run_id`
   - appends eval/plan/run decisions to `hotline_log.jsonl`
5. Report outcomes honestly: if the IVR maze ate the call, say so.

## Safety

- The recipient number lives in the user's environment (`HOTLINE_PHONE`), never in code or repos; it is validated as strict E.164 and must match `HOTLINE_REGION`'s country code (fail-closed for unmapped regions).
- Live dialing requires per-run confirmation (`--yes`); one-time configuration alone never dials.
- One call per bounty, ever, and only after CALL-E confirms the call started; failed runs stay eligible, uncertain runs must not be retried with a new plan.
- Never call businesses or third parties as part of the bounty flow; the hotline calls the consenting owner only.
- All calls, evals, and errors are append-only logged for audit.
- Keep raw call artifacts out of repositories: run IDs, recordings, diarized transcripts, and raw status payloads about any call — including calls to businesses — must not be committed. A public repo is not the right place for call records about a third party. Summarize outcomes in prose instead; identifiers and raw payloads stay in the operator's local, private storage.

## Reference implementation

A complete runnable implementation (feed module, filter daemon, CALL-E integration) lives at [github.com/shamanov39-dev/bounty-hotline](https://github.com/shamanov39-dev/bounty-hotline) (MIT), built for the CALL-E: Your Code Is Calling hackathon.
