# BuddyE agent notes

BuddyE calls frail people during a hazard and decides who needs help. Two rules below are the
product; the rest keep it from doing harm on the way there.

## The two that are not negotiable

- **Silence is a finding.** `NO_ANSWER`, `FAILED` and `INVALID_RESULT` go **into** `decide()` with
  the neighbour's triage attached, and come back `CheckOutcome.UNREACHABLE`. Never add an early
  return that skips an unanswered call, never retry silence away, and never let a neighbour reach
  the end of a sweep with no outcome and no row in `unaccounted()`. If you catch yourself treating
  a call that did not connect as an error to be handled, stop: that call is the output.
- **Never dial an emergency service.** The ladder is EMERGENCY_CONTACT (BuddyE may call) →
  BLOCK_CAPTAIN (BuddyE notifies) → RESPONDER (BuddyE *prepares* a `HandoffPacket` and stops).
  `escalate.release()` is the only function that assigns `released_at`, it requires a human's name,
  and `tests/test_escalate.py` pins both at the source level. Do not import a provider into
  `app/orchestrator/escalate.py`. Do not add a code path that transmits a packet without calling
  `require_released()`. `released_at = null` means nobody has been told anything, and that must stay
  true of every packet the system produces on its own.

## Calls cost real money and reach real people

- CALL-E places REAL phone calls and the free tier is small. Never run `CALL_PROVIDER=calle_sdk` or
  `calle_mcp` as a test or a check. The suite and every default use the mock provider.
- Never place a call as a verification step. `calle call plan` may consume quota; treat it as live.
- Consent is enforced twice on purpose — in `risk.call_order` and again on the row in the runner.
  Do not "simplify" one of them away.
- The dial allowlist and the call budget are enforced in code (`app/calls/budget.py`). Do not add a
  path around them, and do not count the budget from `CheckCall`: the `SpentCall` ledger survives a
  demo reset precisely so the reset button cannot refund the free tier.
- Phone numbers in committed files are fictional `+1 555-01xx` only. Real numbers come from
  `DEMO_PHONE_*` env at seed time and must also appear in `DIALABLE_NUMBERS`.

## Health data

- `conditions`, `power_dependent`, medications, `access_notes` and addresses are sensitive health
  information about named people. Redact at **egress** (`app.obs.redact`), never at the source: a
  triage reason with "oxygen concentrator" removed is useless to the captain it was written for.
- The **call task** is the exception in the other direction. It is persisted and published on the
  event stream, so it is built from derived facts (`power_dependent`, `mobility`, `lives_alone`) and
  must never interpolate a condition, a medication, or an address. First name only. On voicemail,
  not even the reason for the call.
- The handoff packet is deliberately unredacted beyond phones. Do not add a `redact()` to
  `build_handoff_packet` — a packet with the address masked helps nobody.

## The call contract

- The hazard decides which facts are `required` in the CALL-E `result_schema`. Do not relax the
  schema to make a call "succeed": a required field that came back `unknown` is a finding.
- `required` means "the call may not come home without this fact". It does not mean "this must be
  yes". `checks.has_power == "no"` during a blackout is the finding the ladder exists for.
- Every required field must be answerable when nobody picked up (tri-states have `unknown`, arrays
  may be empty, quotes may be `""`). A schema only a completed conversation could satisfy would make
  the most important outcome in the product look like a validation error.
- Keep `assert_calle_schema_subset()` and keep it passing. No nullable type arrays, one level of
  object nesting, arrays of plain strings, every string enum carries `unknown`.
- Field descriptions reach CALL-E's extraction model. Write them as extraction guidance, judged by
  meaning: "yeah I'm alright" and "I'm fine, just a bit warm" are different answers.

## Quotes and words

- `alarming_quote` and `concerns` are the person's own words and are copied verbatim into a handoff
  packet that a responder may hear read out. Never paraphrase into them, and never let the reconcile
  step introduce a sentence that cannot be traced to a human turn in the transcript.
- The reconciler may resolve an `unknown`; it may never overturn a definite answer CALL-E gave.

## Housekeeping

- Never log or print `CALLE_API_KEY`, `CALLE_WEBHOOK_SECRET`, OAuth tokens, or callback URLs.
- `app/models.py` and `app/domain/state.py` are the spine. Changing a state machine changes what the
  ladder is allowed to do; do it deliberately, with the transition table.
- Run `cd backend && .venv/bin/python -m pytest -q` before finishing, and
  `python3 scripts/validate_repository.py` from the repo root before any PR.
