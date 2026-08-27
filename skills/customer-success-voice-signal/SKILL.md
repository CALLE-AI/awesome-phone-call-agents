---
name: customer-success-voice-signal
description: Stage Manager skill that cues CALL-E to ring the CS owner (never the customer) when a named account hits stuck support, SLA risk, agent-needs-decision, or health/onboarding stall — dress rehearsal by default, curtain-up only with --live and PLACES.
license: MIT
---

# customer-success-voice-signal (Stage Manager)

When a **named account** hits a high-risk moment, the **Stage Manager** cues CALL-E to ring the **CS owner only** with a short brief and closed-set line readings — a 1/2/3 decision menu. The structured decision lands in the **prompt book** (NDJSON audit log) and **show report** (markdown writeback).

**Not:** a customer dialer. **Never** call the customer in MVP.

## Glossary

| Term | Meaning |
| --- | --- |
| **Dress rehearsal** | Dry-run. Default. No ring. Cue-history not appended. |
| **Curtain up** | Live CALL-E call. Requires `--live` **and** type/env `PLACES`. |
| **Cue** | Trigger (`stuck_support`, `sla_risk`, `agent_needs_decision`, `health_onboarding`). |
| **Line readings** | Closed-set options 1 / 2 / 3. |
| **Prompt book** | NDJSON audit (`data/prompt-book.ndjson`). |
| **Show report** | Markdown writeback (`data/show-report.md`). |
| **Action intent** | Decision → system handoff JSON (`data/actions/pending/`). Apply with `npm run apply-action`. |
| **Stage code** | 4-digit identity read-back spoken before a 1/2/3 counts as the owner’s decision. |
| **House dark** | Quiet hours. Enforced on curtain-up only. |
| **HOLD** | Policy stop — exit code 2. |

## How judges run this

```bash
cd skills/customer-success-voice-signal
npm install
npm test && npm run typecheck

# Dress rehearsal (default — no secrets needed for dial)
npm run signal -- --fixture stuck_support_acme.json
npm run signal -- --stdin < events/webhook_stuck_support.json

# HTTP inbound — same engine as --stdin (zero extra deps)
npm run serve-cue &
curl -sS -X POST http://127.0.0.1:8787/cue \
  -H 'content-type: application/json' \
  -d @events/webhook_stuck_support.json

npm run apply-action -- --last --dry-run
npm run signal -- --list
npm run signal -- --last
```

### Curtain-up (operator only — real ring)

Requires `CALLE_API_KEY` from **https://dashboard.heycall-e.com/account/api-keys**, plus `CS_OWNER_E164`, and `PLACES`:

```bash
# cp .env.example .env  then fill keys locally (never commit .env)
npm run signal -- --fixture stuck_support_acme.json --live PLACES
```

Details: [references/auth-and-keys.md](references/auth-and-keys.md).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Ok — dress rehearsal or curtain-up completed |
| 2 | HOLD — policy / live gate / house dark / placeholder |
| 3 | Failure — bad cue, missing key, CALL-E error |

## When to use

- Support/AI path stuck on a CS-owned account  
- SLA breach imminent on a named account  
- An agent emits `needs_human` with options  
- Health or onboarding stall before renewal  

## When not to use

- Calling the end customer  
- Medical, emergency, legal, or harassment contexts  
- Guessing phones or skipping consent / opt-in  
- Curtain-up without `--live` + `PLACES`  

## Safety

Read [references/safety.md](references/safety.md).

- Callee is **CS owner only**  
- Fixture phones (`+15555550100`) rejected on curtain-up  
- `CS_OWNER_E164` overrides owner phone on live  
- House dark on curtain-up only (timezone-aware)  
- Per-owner live call budget (`OWNER_MAX_RINGS`)  
- Cue-history only after a live dial — HOLD does not poison dedupe  
- Prefer `failureCode` / `completionConfidence` over summary heuristics  
- Identity read-back (stage code) required before accepting 1/2/3 on curtain-up  

## Writeback

- Prompt book: `data/prompt-book.ndjson`  
- Show report: `data/show-report.md`  
- Cue history (live dial outcomes only): `data/cue-history.ndjson`  
- Action intents: `data/actions/pending/` → `npm run apply-action -- --dry-run` (see [references/action-intents.md](references/action-intents.md))
- Slack/GitHub adapters: **stab only** (out of MVP — do not fire). Dry-run prints the payload.
- HTTP cue: `npm run serve-cue` → `POST /cue` (optional `CUE_WEBHOOK_SECRET`)
- CALL-E SDK notes: [references/calle-sdk.md](references/calle-sdk.md)
