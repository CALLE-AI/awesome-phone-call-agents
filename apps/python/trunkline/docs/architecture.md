# Architecture

Trunkline is a small pipeline with one unusual property: the order of its stages is a safety property, not a preference.

```text
  ledger + vault
        │
        ▼
  workqueue.py ......... bundle by payer and workflow, score by value x deadline
        │
        ▼
  engine.suppression_for  thirteen named holds; any one of them stops the call
        │
        ▼
  vault.resolve_envelope  the only path from an identifier to a call
        │
        ▼
  plan.build_plan ...... task text, closed schema, pre-flight leak check
        │
        ▼
  client.create_call ... POST /v1/calls with Idempotency-Key
        │                 (claims marked pending_call and flushed BEFORE this)
        ▼
  client.wait .......... poll GET /v1/calls/{id} until terminal
        │
        ▼
  hold.derive .......... hold from transcript offsets
        │
        ▼
  verify.verify ........ local schema check, then groundedness against transcript
        │                 (needs the UNSCRUBBED transcript)
        ▼
  redact.scrub_* ....... identifiers removed
        │
        ▼
  ledger + audit.log ... persisted
```

## Three orderings that matter

**Claims are marked `pending_call` and written to disk before the request leaves.** A process killed mid-call leaves evidence that a call may exist. A request error becomes `submission_unknown`, keeps the claims in `pending_reconciliation`, and halts the live batch. Nothing redials a claim in either state; `reconcile` resolves it against CALL-E instead. Marking after the request would make a crash indistinguishable from a call that never happened.

**Verification runs before scrubbing.** The groundedness check needs the transcript as spoken, because that is where the representative's words are. Scrubbing first would delete the evidence the check depends on and every answer would fail. So the transcript is used, then scrubbed, then stored.

**The envelope resolves at call time, and the resolved values are never returned to the ledger.** `Disclosure.values` lives in memory for the length of the call. What is persisted is `fields_disclosed`, the names.

## Where each guarantee is enforced

| Guarantee | Enforced by | Proven by |
| --- | --- | --- |
| A workflow discloses only what it needs | `vault.resolve_envelope` against `policy.DISCLOSURE_ENVELOPES` | `test_envelope_narrows_by_workflow` |
| Some fields are never disclosed at all | The resolver, overriding the envelope; `plan._assert_no_forbidden_disclosure` | `test_envelope_cannot_be_widened_by_a_bad_policy_entry` |
| No identifier reaches disk | `redact.scrub_*` before persistence | `test_no_patient_identifier_survives_a_call`, `trunkline vault-check` |
| No answer without evidence | `verify.is_grounded` | `test_a_fabricated_quote_is_caught_and_only_that_claim_is_reset` |
| No answer outside the schema | `verify.validate_against_schema` | `test_an_out_of_schema_result_is_refused_whole` |
| No live call without written permission | `authz.check` inside `engine.suppression_for` | `test_live_mode_refuses_without_an_authorization_record` |
| No duplicate call | `Idempotency-Key`, plus the `pending_reconciliation` state | `test_an_idempotency_key_stops_a_duplicate_call` |
| The key goes nowhere else | `client.check_origin` | `test_the_api_key_only_goes_to_the_official_origin` |
| The audit trail is not quietly editable | `audit` hash chain | `test_editing_one_entry_breaks_the_chain` |
| Nothing closes without a person | `engine.approve` | `test_approval_is_required_before_a_claim_closes` |

## Why hold is derived rather than measured

CALL-E returns `offset_seconds` on every transcript turn. Nobody speaks while hold music plays, so a long gap between consecutive turns is hold. That needs no new API surface, no timer, and no provider cooperation, and it works identically against a fixture and against a live call.

The threshold is 45 seconds: above a representative pausing to look a claim up, below a queue wait, which runs to minutes. Every gap over the threshold is summed rather than only the first, because a transfer lands the call in a second queue.

## Extending it

A new workflow is four things:

1. An entry in `policy.DISCLOSURE_ENVELOPES` naming the minimum identifiers it needs.
2. A closed per-claim schema in `workflows.py` with `evidence_quote` and every field accepting `unknown`.
3. A `Workflow` registration with `core_fields`, and `conditional_fields` for anything only meaningful once a status is known.
4. A fixture, plus an adversarial one if the workflow introduces a new way to be wrong.

Nothing in `engine.py`, `verify.py`, or `redact.py` needs to change. That is the point of keeping the envelope, the schema, and the completeness rule in data rather than in the pipeline.
