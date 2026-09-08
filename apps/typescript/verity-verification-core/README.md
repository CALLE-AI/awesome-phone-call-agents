# verity-verification-core

A standalone verification core for CALL-E phone tasks. Given a completed call's
snapshot and its transcript, it decides whether it is safe to take the real-world
action the call was supposed to authorize — a calendar write, a CRM update, a
fulfillment step — **before** your integration does it.

It exists because `task_completed: true` from a phone agent is a *claim*, not a fact.
A caller can self-correct mid-sentence, a call can reach voicemail, a value can be
parsed but never actually confirmed. This module treats the claim as necessary but
never sufficient: it re-reads the transcript with a deterministic grammar, checks the
parsed value against what your action would write, requires a strict in-transcript
confirmation, and folds in a fresh check of the resource you are about to mutate.
Any missing field, any thrown error, any open ambiguity → `BLOCK`, never `ALLOW`.

- **No network. No CALL-E calls. No database.** `luxon` is the only runtime dependency.
- The `src/` tree is the pure core extracted from the full Verity project; this app
  wraps it in a runnable **dry-run CLI** and tests.

## Install & run (no calls placed)

```bash
cd apps/typescript/verity-verification-core
npm install

# Dry-run the bundled A / B / D scenarios and assert each expected verdict.
npm run demo

# Type-check and test.
npm run check
npm test
```

`npm run demo` output (abridged):

```
A — clean confirm
  CALL-E claim   : task_completed=true confidence=high
  parsed target  : 2026-09-08 09:00  explicit_confirmation=true
  ambiguity      : [none]
  VERDICT        : ALLOW  reason=allow_clean

B — caller self-corrects mid-sentence, CALL-E still says task_completed:true
  CALL-E claim   : task_completed=true confidence=high
  intended value : 2026-09-10 15:00 (reschedule)
  parsed target  : 2026-09-10 15:30  explicit_confirmation=false
  ambiguity      : [self_correction_unresolved, claim_parse_mismatch]
  VERDICT        : BLOCK  reason=self_correction  (ghost booking prevented)
  repair via SMS : "2026-09-10 15:30 — reply YES to confirm"

D — value parsed but the caller never confirmed it (the adversarial case)
  ambiguity      : [no_explicit_confirmation]
  VERDICT        : BLOCK  reason=no_explicit_confirmation
```

### Run it against your own call

```bash
npm run verify -- ./my-call.json \
  --intent reschedule --intended-date 2026-09-10 --intended-time 15:00 --service haircut
```

`my-call.json` is a CALL-E `WebhookEvent` or a bare `CallTask` (JSON). The CLI reads
`recipients[0].attempts[last].transcript_turns`, never the webhook body's own summary.

## Use it as a library

```ts
import { parseTranscript, detect, decide } from "verity-verification-core/src/index.js";

const parsed = parseTranscript(callTask.transcriptTurns, {
  businessTz: "America/New_York",
  callCreatedAt: callTask.created_at,
});
const ambiguity = detect({
  parsed,
  intent: "reschedule",
  intended_value,           // what your task asked for
  original_hold_value: intended_value,
});
const decision = decide({
  intent: "reschedule",
  intended_value,
  original_hold: { hold_id, slot_id, value: intended_value, expires_at }, // from YOUR resource store
  calle: { status, task_completed, completion_confidence, structured_result },
  parsed,
  ambiguity,
  matched_fixtures: [],      // from your own learned-pattern store, if any
  slot_recheck: { slot_id, held_by_hold_id, available, sandbox_ok },      // a FRESH read, < 2s old
  now: new Date().toISOString(),
});

if (decision.decision === "ALLOW") commitTheAction();
else openSecondChannel(decision.repair_target);   // e.g. an SMS "reply YES to confirm 3:30"
```

`decide()` runs an ordered set of BLOCK checks, then the E1–E7 required-evidence
predicates, then `ALLOW`. E1 (`task_completed === true`) is explicitly "necessary,
never sufficient": E3 (parsed value **exactly** equals the action's value), E4 (a bot
turn restated the full value and the caller affirmed it), and E6 (a fresh resource
re-check) must all also hold.

## Going live (opt-in, outside this module)

This module never places a call and never reads a credential. When your integration
actually calls CALL-E:

- **Credentials stay server-side.** Keep `CALLE_API_KEY` in the server environment
  only. Never put it in a client bundle, a log line, a webhook URL, or a response body.
  This module has no code path that reads, receives, or transmits it — it operates
  purely on the call snapshot you hand it.
- **Don't trust the webhook body.** Treat `POST /calle/webhook` as "a result may
  exist". Re-fetch `GET /v1/calls/{id}` server-side and run `decide()` on that
  snapshot (CALL-E does not sign webhooks).
- **Feed a real `slot_recheck`.** The dry-run CLI synthesizes one; in production it
  must be a read of your calendar/resource taken immediately before `decide()`, so a
  slot lost between the hold and the write is caught (`reason_code: "slot_lost"`).
- **Idempotent side effects.** `decide()` is a pure function of its input; call it as
  many times as you like. Make the *action* it authorizes idempotent on your side.

## What's in `src/`

| Export | Role |
|---|---|
| `parseTranscript(turns, ctx)` | Deterministic date/time grammar → `ParsedTranscript`: candidate datetimes, self-correction events, resolved target(s), a strict "did the caller confirm the restated value" flag. No LLM ever supplies a booking value. |
| `detect(input)` | Parse → typed risk flags: `self_correction_unresolved`, `multi_time_mention_unresolved`, `relative_date_ambiguity`, `no_explicit_confirmation`, `claim_parse_mismatch`. |
| `decide(GateInput): Decision` | The gate. Fail-closed. Returns `ALLOW` / `BLOCK` + `reason_code` + a `repair_target` for the second channel + `ghost_booking_prevented`. |
| `normalizePattern` / `skeleton` / `assertPatternPiiClean` | Turn a caught failure transcript into a PII-safe matcher for a learned-pattern store; the validator rejects a pattern that still holds a raw name / E.164 / calendar date. |

## Safety

Phone calls and the actions they authorize are real-world side effects. See the
companion skill's [`references/safety.md`](../../../skills/verity-verification-core/references/safety.md):
explicit user intent, E.164 handling, masked numbers in summaries, no credential
exposure, no hidden schedules, no duplicate jobs, cancellation behavior, and
medical / legal / financial / emergency boundaries.

License: MIT.
