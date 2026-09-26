---
name: verity-verification-core
description: Gate a CALL-E phone task's task_completed claim behind an independent transcript read-back before any real-world action. Use after a confirm, reschedule, or book call to decide ALLOW or BLOCK, catch a mid-sentence self-correction, a voicemail, or a value the caller never actually confirmed, and get the exact value to re-confirm on a second channel. Deterministic, no network, fail-closed.
license: MIT
---

# Verity Verification Core

Use this skill in the gap between a CALL-E call finishing and your agent acting on it.
CALL-E reports `task_completed: true`; this skill decides whether that is *safe to act
on*. It re-reads `transcript_turns` with a deterministic grammar, checks the parsed
value against what your action would actually write, requires a strict in-transcript
confirmation, and folds in a fresh check of the resource you are about to change. Any
missing field, any open ambiguity, any thrown error resolves to **BLOCK**, never ALLOW.
`task_completed == true` is necessary, never sufficient.

It does not place calls, hold slots, or write calendars. It turns one call snapshot
into `ALLOW` / `BLOCK` + a `reason_code` + a `repair_target` to confirm elsewhere.

## When to use

- After a CALL-E `confirm`, `reschedule`, or `book` call whose result will trigger a
  real-world write (a calendar entry, a CRM update, a fulfillment step).
- When you need to tell "the caller agreed to 3:30" apart from "CALL-E's summary says
  3:00", "the call reached voicemail", or "a time was mentioned but never confirmed".
- When a caught failure should govern *future* calls: the skill can turn a blocked
  transcript into a PII-safe pattern for your own learned-pattern store.

## When not to use

- To place or schedule the call. That is your CALL-E integration's job — see
  [`references/calle-handoff.md`](references/calle-handoff.md).
- As a source of the booking value. The value always comes from the deterministic
  grammar over the transcript, never from a model and never from CALL-E's summary.
- For medical, legal, financial-advice, or emergency call content. See
  [`references/safety.md`](references/safety.md).

## Workflow

1. **Preview.** Run [`scripts/preview_gate.py`](scripts/preview_gate.py) with your
   intent + the value the task will write. It prints the call plan (task text,
   `result_schema`, a deterministic idempotency key, a masked recipient) and the
   exact E1–E7 checklist the gate will apply. No call is placed.
2. **Get explicit user intent** for that specific recipient and value before any call
   is placed. Read [`references/safety.md`](references/safety.md).
3. **Place the call** through your own CALL-E integration with the previewed plan.
4. **Re-fetch, don't trust the webhook.** CALL-E does not sign webhooks; fetch
   `GET /v1/calls/{id}` server-side and reconcile that snapshot.
5. **Reconcile.** Run [`scripts/reconcile_call.py`](scripts/reconcile_call.py) with
   the call snapshot + the same intent/value. It prints `ALLOW` / `BLOCK`, the
   `reason_code`, and on BLOCK the `repair_target` to quote on a second channel
   (e.g. an SMS "reply YES to confirm 3:30"). Voicemail, self-correction, ambiguity,
   and an unconfirmed value are all reported as BLOCK, never as a verified result.
6. **Act only on `ALLOW`.** On `BLOCK`, open the second channel with `repair_target`,
   or route to a human. Never let a `BLOCK` fall through to the write.

## Quick start (no network, no CALL-E account)

```bash
cd skills/verity-verification-core

python scripts/preview_gate.py --input assets/experience-b.input.json
python scripts/reconcile_call.py --call assets/experience-b.call.json --input assets/experience-b.input.json
python scripts/self_test.py            # runs A / B / D, asserts each expected verdict
```

The bundled scripts use only the Python standard library and never open a socket.
The reference implementation with full timezone handling is the TypeScript app at
`apps/typescript/verity-verification-core/` (`npm install && npm run demo`).

## What the gate checks (E1–E7)

| | Requirement |
|---|---|
| E1 | `task_completed == true` and confidence is not `low` — necessary, never sufficient. |
| E2 | The transcript resolves to **exactly one** datetime after self-correction. |
| E3 | That parsed value **exactly equals** what the action would write (date + time + tz). |
| E4 | A bot turn restated the full value **and** the caller affirmed it (a bare "yes" after a partial restatement does not count). |
| E5 | No open ambiguity flag (`self_correction_unresolved`, `multi_time_mention_unresolved`, `relative_date_ambiguity`, `no_explicit_confirmation`, `claim_parse_mismatch`). |
| E6 | A **fresh** re-check shows the resource is still yours and not expired. |
| E7 | No learned failure pattern demands a second channel or a hard block. |

All seven must hold together for `ALLOW`. Full walkthroughs of the three headline
cases are in [`references/examples.md`](references/examples.md).
