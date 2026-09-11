# Action intents — decision → system handoff

Stage Manager captures a **closed-set CS decision** on the phone, then emits an **action intent**: the contract the next system executes.

PagerDuty-style tools often stop at **acknowledge**. We stop at a **decision**, then make the next system move **explicit and executable**. The **JSON action intent** is the in-scope seam. Slack-shaped webhook and GitHub issue-comment adapters are a **stab** (code exists to show the handoff is possible) — **out of MVP; do not fire**. Zendesk / Salesforce shapes are documented at the seam — never claimed as wired.

## Seam (end-to-end, judge-visible)

```text
Webhook-shaped JSON / fixture / stdin / POST /cue
        ↓
  Stage Manager (policy → dress rehearsal | curtain-up)
        ↓
  Prompt book + show report
        ↓
  data/actions/pending/<intent_id>.json     ← action intent
        ↓
  npm run apply-action -- --last --dry-run  ← prove the handoff
        ↓
  data/actions/executed/<receipt>.json      ← receipt (local, or live-adapter send)
```

The **JSON shape is the product seam**. Slack/GitHub adapters ride it as a **stab only** — `--dry-run` prints the payload. Live POST is **out of MVP scope** (do not set the webhook to fire a real channel):

```bash
# Slack-shaped webhook — STAB only. Dry-run prints {text}. Do not fire.
npm run apply-action -- --last --adapter slack --dry-run

# GitHub issue comment — same stab
npm run apply-action -- --last --adapter github --dry-run

# Both honor --dry-run (prints exact payload, no network)
# Live HTTP send is out of MVP (CLI HOLDs). Unset env also HOLDs — never a silent no-op
```

## Run it

```bash
cd skills/customer-success-voice-signal
npm install

# 1a) Inbound cue via stdin (webhook-shaped — not fixtures-only)
npm run signal -- --stdin < events/webhook_stuck_support.json

# 1b) Or inbound via HTTP listener (same engine — deployable)
npm run serve-cue &
curl -sS -X POST http://127.0.0.1:8787/cue \
  -H 'content-type: application/json' \
  -d @events/webhook_stuck_support.json

# 2) Inspect pending action intent
ls data/actions/pending/
npm run apply-action -- --last --dry-run

# 3) Local “execute” (no external call — writes a receipt)
npm run apply-action -- --last

# Stab only (out of MVP — do not fire): dry-run shows the Slack-shaped payload
npm run apply-action -- --last --adapter slack --dry-run
```

### HTTP cue listener

`npm run serve-cue` binds `POST /cue` (and `GET /health`) with zero extra deps.

| Query / env | Effect |
| --- | --- |
| (none) | Dress rehearsal (default) |
| `?dry_run=1` | Force dress rehearsal |
| `?live=1&confirm=PLACES` | Curtain-up **only if** `CUE_ALLOW_LIVE=1` is set — otherwise **403 HOLD** (webhook cannot arm itself) |
| `CUE_WEBHOOK_SECRET` | Required for non-loopback bind; Bearer / `X-Cue-Secret` |
| `CUE_ALLOW_LIVE=1` | Operator arming switch for HTTP live |

Judge demo story: **curl → dress rehearsal → apply-action --dry-run**. Live phone still needs a separate human arm (`CUE_ALLOW_LIVE` + CLI/`PLACES` semantics). Slack live send is out of MVP. See [safety.md](safety.md).
## What an intent contains

| Field | Meaning |
| --- | --- |
| `action` | Stable verb (`assign_owner_to_ticket_and_post_note`, …) |
| `adapter` | Primary target (`zendesk_ticket_note`, `salesforce_task`, `slack_webhook`, `internal_queue`) |
| `adapters_planned` | Full Monday-morning adapter family |
| `payload` | Account, ticket, owner, `call_run_id`, optional `follow_up_at` |
| `status` | `pending` → `dry_run_printed` / `executed_local` |

HOLD / failure / unclear / no_answer do **not** emit intents — only option `1` / `2` / `3`.

## Honesty

- `--dry-run` and local apply **never** call external APIs.
- Receipts say `effect: "local_receipt"` from the CLI. `sendToSlack` / `sendToGithubIssue` exist as a **stab** (unit-tested) — the CLI HOLDs live send (out of MVP).
- Unset or placeholder adapter env HOLDs (exit 2) instead of pretending.
- Zendesk / Salesforce remain documented shapes, not wired adapters.
- Slack / GitHub HTTP send is a **stab** — out of MVP. Do not fire a real channel.
