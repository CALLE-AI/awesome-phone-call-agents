# Examples

Every transcript below is **real output from the command shown**, captured on a clean
checkout with no API key and no network access. Nothing here was written by hand, and
nothing here dialled a number.

All roster records are synthetic. `safety.md` separates which guarantees are code
gates and which are prompt constraints; this file only shows what the code does.

## 1. Rank only (the default)

```
$ python run_batch.py
```

```
Call priority (ranked by risk - most urgent first):
  1. PB-SIM-03-NOANS
  2. PB-SIM-07-OK
  3. PB-SIM-01-OK
  4. PB-SIM-09-PARTIAL
  5. PB-SIM-02-DECL
  6. PB-SIM-04-THIN
  7. PB-SIM-05-VM
  8. PB-SIM-06-WRONG
  9. PB-SIM-08-OK

(dry-run: nothing was dialled. Use --simulate for the full FakeAdapter loop)
```

`PB-SIM-03-NOANS` is called first: a ventilator with **no recorded battery level**.
Unknown equipment and unknown battery both rank as *most* urgent, so a missing field
can never push a household down the queue.

## 2. Consent preview - what the operator approves before anything is dialled

```
$ python run_batch.py --show-preview
```

```
Pre-call consent preview (consent-first: no dial without this step)
  Case: PB-SIM-03-NOANS
  Callee (masked): +886*******03
  Scenario: outage_welfare_check (en)
  Disclosure allowlist (the agent is told to say ONLY these): caller_identity, outage_status
  What the agent will be told to say (first sentence is always the AI disclosure):
    You are speaking with PowerBack, an automated AI assistant calling on behalf of the
    local disaster response coordination. This call may be summarized for welfare tracking.
    Ask if the resident and their electric medical equipment user are safe, whether they
    currently have power, and roughly how many hours of battery remain. Information you are
    allowed to share: You may state you call for the disaster response coordination. You may
    share the current outage status for their district. Do NOT share any other information.
    If asked something outside this list, say you will arrange a human follow-up. If the
    person declines to talk, thank them and end the call immediately. Keep the call under
    two minutes. Speak clearly and slowly.
  (8 more cases, same shape - use --show-preview-all to print them)
```

The number is masked before the preview is produced, so it can be shown, logged, or
screen-shared. The first sentence of the task text is always the AI self-disclosure,
and the permitted facts are enumerated into it.

Both of those are **prompt constraints, not output filters** - `safety.md` says so
rather than claiming a guarantee we cannot make.

## 3. Full loop against the offline FakeAdapter

```
$ python run_batch.py --simulate
```

```
Triage board:
  [needs_help] 3 case(s)
    - PB-SIM-07-OK answered_needs_help needs=['generator'] conf=high
      Handoff context (allowlisted fields only):
        case_id: PB-SIM-07-OK
        scenario: outage_welfare_check
    - PB-SIM-01-OK answered_needs_help needs=['generator'] conf=high
      Handoff context (allowlisted fields only):
        case_id: PB-SIM-01-OK
        scenario: outage_welfare_check
    - PB-SIM-08-OK answered_needs_help needs=['generator'] conf=high
      Handoff context (allowlisted fields only):
        case_id: PB-SIM-08-OK
        scenario: resource_needs_survey
  [human_followup] 3 case(s)
    - PB-SIM-09-PARTIAL advisory_needs_review needs=['none'] conf=medium
      Handoff context (allowlisted fields only):
        case_id: PB-SIM-09-PARTIAL
        scenario: outage_welfare_check
    - PB-SIM-04-THIN insufficient_data needs=None conf=low
      Handoff context (allowlisted fields only):
        case_id: PB-SIM-04-THIN
        scenario: resource_needs_survey
    - PB-SIM-06-WRONG wrong_person needs=None conf=high
  [retry_queue] 2 case(s)
    - PB-SIM-03-NOANS no_answer needs=None conf=high
    - PB-SIM-05-VM voicemail needs=None conf=high
  [confirmed_safe] 0 case(s)
  [do_not_disturb] 1 case(s)
    - PB-SIM-02-DECL declined needs=None conf=high
```

### Why each case landed where it did

| Case | Code | Reason |
|---|---|---|
| `PB-SIM-01-OK`, `-07-OK`, `-08-OK` | `answered_needs_help` | The model returned a **structured result bound to the declared schema**. That is actionable, so it dispatches. |
| `PB-SIM-09-PARTIAL` | `advisory_needs_review` | The call dropped before the model could fill the schema. A summary can still be derived from the words, but **keyword matching is not an assessment** - it is marked `heuristic_advisory`, always carries `needs_human`, and never dispatches. |
| `PB-SIM-04-THIN` | `insufficient_data` | Confidence `0.35`, below the `0.6` gate. No structured result is emitted at all. |
| `PB-SIM-06-WRONG` | `wrong_person` | Someone answered, but not the resident. Its own terminal state, not a failure. |
| `PB-SIM-03-NOANS`, `-05-VM` | `no_answer`, `voicemail` | Retry. No content evidence recorded. |
| `PB-SIM-02-DECL` | `declined` | A refusal. **No evidence is produced and it is never counted toward anything.** |

### The distinction this board exists to make

`needs_help` and `advisory_needs_review` both describe a household that may need
something. Only the first may dispatch, because only the first came from a result
bound to the schema. The second says, in effect, *a person should listen to this one*
- which is the honest answer when all we have is a keyword match.

`assessment_basis` carries that provenance on every result: `model_structured`,
`heuristic_advisory`, or `none`.

## 4. Checking the live request without placing a call

```
$ python scripts/check_sdk_contract.py
```

```
Checking the live request against calle-ai==1.0.1
(offline: no API key, no network, no SDK import, no call placed)

  PASS  request binds to the published create() signature
  PASS  destination is sent as 'phone' (SDK 1.0 removed recipient/recipients)
  PASS  idempotency_key is present and non-blank - powerback:2026-10-12-demo:PB-SIM-01-OK:v1
  PASS  result_schema is present
  PASS  result_schema sets additionalProperties: false
  PASS  result_schema has at most 32 properties - 10 properties
  PASS  every property is a scalar type (no arrays, no nullable unions)
  PASS  every required property is declared - is_safe, has_power, confidence_label
```

This binds the request this skill would send against the `create()` signature
published in `calle-ai==1.0.1`, and checks the result schema against the
`calle.result.scalar-object.v1` profile. It runs with **no API key, no network, no
SDK import, and no call placed**.

It is the check that would have caught the earlier mistake in this contribution: a
request built with `to=` instead of `phone=` fails to bind with
`missing a required argument: 'phone'`, and omitting the idempotency key fails with
`missing a required argument: 'idempotency_key'`.

**What it establishes**: a live request would be accepted by the SDK rather than
raising `TypeError`.
**What it does not establish**: that a call connects, or that the provider behaves as
documented. See `references/sdk_contract.md`.

## 5. Live calling

Not shown here, because running it would place a real phone call.
**No live call has been placed from this skill.**

Five independent gates:

```python
engine.run(call_input, mode="live", human_confirmed=True, adapter=RealAdapter())
```

```
CALLE_API_KEY=...                       # 1. credentials
PB_ALLOW_REAL_CALL=1                    # 2. explicit environment opt-in
PB_ALLOWED_DESTINATIONS=+886900000001   # 3. operator allowlist, no wildcard
PB_BATCH_ID=2026-10-12-morning          # 4. durable idempotency key
```

plus `human_confirmed=True` in code — an operator approved the preview above.

`PB_ALLOWED_DESTINATIONS` being unset or empty means **no destination is authorised**.
A roster row carrying the wrong number cannot place a call to a stranger: it raises
`DestinationNotAuthorised` before the SDK is even imported.

`PB_BATCH_ID` makes the idempotency key durable — `powerback:<batch>:<case_id>:v1`.
A network retry of the same case in the same batch cannot place a second call to a
household that is already dealing with an outage.

Live calling is deliberately not reachable from the CLI.
