# Auth and keys

Stage Manager loads env via `src/config/env.ts` (`loadDotEnv` + `readSkillEnv`).

## Get / rotate CALL-E API keys

**Create, copy, or rotate keys here:**

**https://dashboard.heycall-e.com/account/api-keys**

Paste the value into local `.env` as `CALLE_API_KEY=…`.  
Never commit `.env`. Swap keys anytime — no code changes.

Dress rehearsal does **not** need a key. Curtain-up does.

## Required for curtain-up

| Variable | Purpose |
| --- | --- |
| `CALLE_API_KEY` | CALL-E Developer API key from [API keys](https://dashboard.heycall-e.com/account/api-keys) (`CalleClient`) |
| `CS_OWNER_E164` | Real CS owner phone (overrides fixture placeholder) |
| `SIGNAL_CONFIRM` | Must be `PLACES` (or pass `PLACES` on argv with `--live`) |

## Optional

| Variable | Purpose |
| --- | --- |
| `CALLE_BASE_URL` | Default `https://api.heycall-e.com` |
| `CALLE_REGION` / `CALLE_LOCALE` | Recipient region/locale |
| `CALLE_WEBHOOK_URL` | Optional `CreateCallInput.webhookUrl` (terminal POST) |
| `CALLE_WAIT` | Default true. Set `0` with webhook URL to skip `waitForResult` (async) |
| `CS_OWNER_NAME` / `CS_OWNER_ID` | Override call sheet identity |
| `HOUSE_DARK_START` / `HOUSE_DARK_END` | Explicit quiet-hours override (both required; else owner `quiet_hours`) |
| `HOUSE_DARK_TIMEZONE` | Optional TZ for env override |
| `OWNER_MAX_RINGS` | Max live dials per CS owner per window (default 2) |
| `DEDUPE_MINUTES` | Cue-history window |
| `DATA_DIR` | Prompt book / show report directory |
| `CUE_HOST` / `CUE_PORT` | HTTP listener bind (`npm run serve-cue`, default `127.0.0.1:8787`) |
| `CUE_WEBHOOK_SECRET` | Required for non-loopback bind; Bearer / `X-Cue-Secret` |
| `CUE_ALLOW_LIVE` | Must be `1` before HTTP `?live=1&confirm=PLACES` can curtain-up (webhook cannot arm itself) |
| `SLACK_WEBHOOK_URL` | Slack-shaped adapter **stab** — leave unset (out of MVP; do not fire) |
| `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_ISSUE` | GitHub comment adapter **stab** — leave unset |

SDK mapping + identity read-back: [calle-sdk.md](calle-sdk.md). Listener safety: [safety.md](safety.md).

## Rules

- Never commit `.env`
- Never print API keys or full phone numbers in logs (mask E.164)
- Dress rehearsal does not need `CALLE_API_KEY` to succeed
- Use `.env.example` as the empty placeholder template
- More CALL-E notes: [`../../../research/calle-api-notes.md`](../../../research/calle-api-notes.md)
