# Cura — Safety notes

These rules apply to any skill, agent, or operator driving Cura / CALL-E clinical check-ins.

## Explicit user intent

- Do **not** place a live call unless a coordinator explicitly clicks **Call now**, **Trigger follow-up call**, or runs `schedule_calls` without `--dry-run` with a configured API key.
- Default demos use **dry-run** and **simulate_webhook** only.

## Phone numbers

- Store and dial **E.164** numbers only (e.g. `+14155550100`).
- Mask numbers in summaries, screenshots, PRs, and logs (`+1415555****`).
- Seed / docs must use fictional or reserved example numbers — never real patient phones in the contribution repo.

## Credentials

- Never print, commit, or paste `CALLE_API_KEY`, webhook secrets, or session cookies.
- Prefer environment variables / secret managers.

## Recurring schedules

- Recurring check-ins are created by `generate_schedule` + `schedule_calls` (cron-ready scripts in the full repo).
- Cancellation: stop cron jobs; deactivate trial or withdraw patient; do not leave unattended live schedulers on shared demo hosts without a kill switch.
- Avoid duplicate jobs: scheduling logic skips patients who already have an active/completed check-in for the local day (see full app docs).

## Clinical / emergency boundaries

- Cura is a **clinical trial coordination aid**, not emergency dispatch, diagnosis, or legal/financial advice.
- High severity / emergency triage flags **require clinician review** in the dashboard — they do not auto-dial emergency services.
- Do not instruct the voice agent to provide medical treatment advice beyond protocol check-in questions.

## Data minimization

- Prefer pseudonymized `patient_code` IDs in demos.
- Do not publish real transcripts, recordings, or PHI in PRs, issues, or Devpost galleries.
