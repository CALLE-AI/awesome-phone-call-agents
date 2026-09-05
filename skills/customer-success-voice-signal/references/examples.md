# Examples — Stage Manager

Fictional reserved numbers only (`+1555555…`). Never put real phones or API keys in samples.

## End-to-end seam (recommended judge path)

```bash
cd skills/customer-success-voice-signal
npm install

# Webhook-shaped inbound cue (not fixtures-only)
npm run signal -- --stdin < events/webhook_stuck_support.json

# Same cue via HTTP listener (deployable — not file-piped)
npm run serve-cue &
curl -sS -X POST http://127.0.0.1:8787/cue \
  -H 'content-type: application/json' \
  -d @events/webhook_stuck_support.json

# Decision → action intent → dry-run (no Zendesk/Slack call)
npm run apply-action -- --last --dry-run

# Local POC receipt (still no external API)
npm run apply-action -- --last

# Stab only — prints Slack-shaped payload; do not live-send (out of MVP)
npm run apply-action -- --last --adapter slack --dry-run
```

See [action-intents.md](action-intents.md).

## Dress rehearsal (default — no ring)

```bash
npm run signal -- --fixture stuck_support_acme.json
npm run signal -- --stdin < events/sample_stuck_support.json
```

Exit `0`. Writes prompt book + show report + pending action intent (for options 1/2/3). Does **not** append cue-history.

## Curtain-up (opt-in live ring)

Requires local `.env` (`CALLE_API_KEY`, `CS_OWNER_E164`) and typed `PLACES`:

```bash
npm run signal -- --fixture stuck_support_acme.json --live PLACES
```

Callee is the **CS owner only**. Customer is never dialed.

Before a 1/2/3 counts, the owner must speak the **stage code** (identity read-back). Prefer SDK `failureCode` / `completionConfidence` over summary heuristics — see [calle-sdk.md](calle-sdk.md).

## Policy HOLDs (exit 2)

| Situation | What happens |
| --- | --- |
| `--live` without `PLACES` | HOLD — stays in dress rehearsal |
| Severity below high | HOLD — `severity_below_threshold` |
| House dark (owner/env timezone) | HOLD — no live ring |
| Owner call budget exceeded | HOLD — `owner_budget` |
| Cue already dialed recently | HOLD — `already_cued` |
| Placeholder fixture phone on live | HOLD — `placeholder_phone` |

## Side effects

| Mode | Side effect |
| --- | --- |
| Dress rehearsal | Local files under `data/` (prompt book, show report, action intents) |
| Curtain-up | One CALL-E phone call to `CS_OWNER_E164` + local writeback + action intent |
| `serve-cue` + `POST /cue` | Same as CLI dress rehearsal / curtain-up (query `?live=1&confirm=PLACES`) |
| `apply-action --dry-run` | Local dry-run receipt only |
| `apply-action` (no dry-run) | Moves intent to executed + local receipt — **no** live CRM/Slack |
| `apply-action --adapter slack\|github` | Stab: `--dry-run` prints payload. Live HTTP send is **out of MVP** (do not fire). |
Cancel / do not ring: omit `--live`, or do not type `PLACES`. There is no recurring schedule.
