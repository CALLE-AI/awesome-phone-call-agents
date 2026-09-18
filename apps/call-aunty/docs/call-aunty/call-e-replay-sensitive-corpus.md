# Call Aunty corpus addendum — end-to-end replay and sensitive-answer branches

All names, identifiers, transcripts, and outcomes below are synthetic QA fixtures. They do not represent real outreach.

This addendum extends the SMS / REST / MCP corpus with:

- deterministic **end-to-end replay** fixtures that stitch SMS turns, `POST/GET /v1/calls`, and MCP `plan_call` / `run_call` / `get_call_run`
- **sensitive-answer branches** that the survey engine must take when a respondent refuses, reports distress, leaks PII, skips remaining questions, or asks for a human callback

Typed sources:

- `lib/mock-calls/corpus.ts`
- `lib/mock-calls/replay.ts`
- `lib/mock-calls/sensitive-branches.ts`

---

## Replay conventions

- `contact_id` values are `demo-contact-*` only.
- `run_id` and `plan_id` are `run_mock_*` / `plan_mock_*` and must persist across retries.
- Idempotency keys never change on a transient retry.
- Bearer tokens are always `<REDACTED>`.
- A refusal or DNC flag suppresses further REST create and MCP `run_call`.
- MCP `run_call` requires a prior `plan_call` and `confirmation: true`.

---

## Replay fixture 001 — `replay-e2e-complete`

**Purpose:** Happy-path SMS consent, REST create/poll, MCP get.

USER  [replay-complete] Hi Aunty Cora. This is the fictional Call Aunty survey assistant. Is now a good time for a short survey?
AUNTY [replay-complete] Yes, I have a few minutes.
SYSTEM [replay-complete] consent=true
AUNTY [replay-complete] Q1: Very positive.

REST `POST /v1/calls` Idempotency-Key: `mock-replay-complete` → `run_id=run_mock_004` status=`queued`
REST `GET /v1/calls/run_mock_004` → status=`completed`
MCP `plan_call` → `plan_id=plan_mock_004`
MCP `run_call` confirmation=true → status=`started`
MCP `get_call_run` → status=`completed`

Expected: one minted run identifier, no outreach suppression, escalation=`none`.

---

## Replay fixture 002 — `replay-e2e-callback-resume`

**Purpose:** Callback window then resume without minting a second run.

AUNTY [replay-callback] Not right now. Could you text me tomorrow afternoon?
SYSTEM [replay-callback] status=callback_requested callback_window=15:00-17:00 local consent=pending durable=true

REST create + poll `callback`, then retry with the **same** idempotency key `mock-callback-002`.
Final MCP `get_call_run` is `completed` on `run_mock_002`.

---

## Replay fixture 003 — `replay-e2e-transient-retry`

**Purpose:** Classify `MOCK_TRANSIENT` separately from a terminal refusal.

REST create → poll `timeout` → retry same key → poll `completed` → MCP `get_call_run` `completed`.
`run_id` stays `run_mock_011`.

---

## Replay fixture 004 — `replay-e2e-refusal`

**Purpose:** Consent denial must not create a second synthetic outreach.

AUNTY [replay-refusal] No, thanks. I do not want to do a survey.
SYSTEM [replay-refusal] status=declined follow_up_suppressed=true survey_started=false

REST `POST /v1/calls` is policy-blocked. MCP `run_call` does not start. No `run_id` is minted.

---

## Replay fixture 005 — `replay-e2e-distress`

**Purpose:** Safety-sensitive language persists a code, not a quotable narrative.

AUNTY [replay-distress] Yes.  (consent=true)
AUNTY [replay-distress] I have chest pain and it is hard to breathe.

Persisted `q06` = `safety_concern_reported`. Escalation = `safety_script`. REST/MCP summaries must not include the raw phrase.

---

## Replay fixture 006 — `replay-e2e-pii`

**Purpose:** Open-text PII is redacted before durable REST/MCP results.

AUNTY [replay-pii] Email me at aunty.pat@example.test if you need more detail.

Persisted `q08` contains `[redacted-email]` and must not contain `aunty.pat@example.test`.

---

## Replay fixture 007 — `replay-e2e-skip-remaining`

AUNTY [replay-skip] Please skip the rest.

Escalation = `stop_probing`. Remaining optional questions are unasked. The run may still complete.

---

## Replay fixture 008 — `replay-e2e-mcp-confirm`

MCP `run_call` before `plan_call` → `blocked`.
MCP `run_call` with `confirmation=false` → `blocked`.
MCP `run_call` with `confirmation=true` after plan → `started`, then `get_call_run` `completed`.

---

## Sensitive-answer branches

| id | Spoken / answer | Category | Escalation | Persist |
|---|---|---|---|---|
| `branch-consent-refused` | No, thanks. | `consent_refused` | none | `false`; no later questions |
| `branch-negative-experience` | Somewhat negative | `negative_experience` | none | skip q09/q10 |
| `branch-very-negative-experience` | Very negative | `negative_experience` | none | skip q05/q09/q10/q15 |
| `branch-distress-en` | chest pain / trouble breathing | `distress` | `safety_script` | `safety_concern_reported` |
| `branch-distress-bn` | তীব্র ব্যথা হচ্ছে | `distress` | `safety_script` | `safety_concern_reported` |
| `branch-skip-remaining` | Please skip the rest. | `skip_requested` | `stop_probing` | keep text; stop optional |
| `branch-skip-null` | structured `null` | `skip_requested` | `stop_probing` | `null` |
| `branch-contact-opt-out` | No follow-up | `contact_opt_out` | none | skip q19 |
| `branch-pii-email` | aunty.pat@example.test | `pii_risk` | none | `[redacted-email]` |
| `branch-pii-phone` | +1 555 555 0199 | `pii_risk` | none | `[redacted-number]` |
| `branch-human-followup` | Very negative + wants contact | `human_followup` | `human_callback` | `true` |
| `branch-happy-path` | Very positive | `null` | none | ordinary persist |

### Expected assertions shared by every distress branch

- Do not ask remaining optional questions.
- Do not quote the raw narrative in a result payload.
- Agent script includes `safety_stop_probing`.

### Expected assertions shared by every PII branch

- Durable answers contain a redaction token, not the original address or number.
- The survey may continue; this is not a safety stop.
