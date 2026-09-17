# Worked examples

Every example here runs offline and places no calls. Phone numbers use the NANP `555-01XX` range reserved for fiction, and the NPI is the published test value.

## 1. Build the task and see what is disclosed

```bash
python3 scripts/build_call_plan.py preview --request references/example_request.json
```

`references/example_request.json` deliberately carries more than the workflow may use. The patient object holds a Social Security fragment, a medical record number, a home address, and a patient phone number alongside the member id and date of birth.

The preview reports:

```text
workflow:        claim_status
destination:     +12*******42
claims on call:  2
disclosed fields: {"CLM-2026-004417": ["date_of_birth", "member_id", "patient_last_name"], ...}
calls_placed:    0
```

Three fields disclosed, four dropped. The dropped values appear nowhere in the task text.

## 2. The envelope narrows with the question

Change `"workflow"` to `"eligibility"` in the same request and preview again:

```text
disclosed fields: {"CLM-2026-004417": ["date_of_birth", "member_id"], ...}
```

The last name is gone. Verifying coverage does not need a name, so eligibility never asks for one. This is the minimum-necessary rule expressed as data rather than as a sentence in a prompt.

## 3. Place the call

Take the printed `task` and `result_schema` and hand them to CALL-E. With the MCP tools, `plan_call` then `run_call`, then poll `get_call_run` about sixty seconds after the call starts and every five to ten seconds after that. With the Developer API:

```bash
curl "$CALLE_BASE_URL/v1/calls" \
  --request POST \
  --header "Authorization: Bearer $CALLE_API_KEY" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: trunkline-clm-2026-004417-a1" \
  --data @call-request.json
```

Persist the returned call id before you start waiting. A payer call including hold regularly runs past thirty minutes; if your process dies, read that call id again rather than placing a second call.

## 4. Check an honest answer

```bash
python3 scripts/build_call_plan.py check \
  --request references/example_request.json \
  --result references/example_result.json
```

```text
reference: MHP-REF-88417203   representative: Marcus
  CLM-2026-004417  grounded
  CLM-2026-004612  grounded

2 grounded, 0 reset
```

Both quotes were found in the transcript, so both answers stand. The paid claim carries an amount, a trace number, and a date; the denied claim reports `unknown` for the amounts, which is correct rather than incomplete.

## 5. Check a fabricated answer

`references/example_result_ungrounded.json` is the same call with one quote replaced by a fluent, plausible sentence that nobody said on the line.

```bash
python3 scripts/build_call_plan.py check \
  --request references/example_request.json \
  --result references/example_result_ungrounded.json
```

```text
  CLM-2026-004417  grounded
  CLM-2026-004612  NOT GROUNDED - fields reset to unknown, send to human review

1 grounded, 1 reset
```

Exit status is `1`. The invented denial code does not reach the billing system; it becomes `unknown` and a person looks at it. The honest answer on the same call is untouched, so one bad extraction does not throw away a twenty-minute hold.

This is the case worth designing for. A denial code nobody said is worse than no answer, because a biller will act on it.

## 6. What a good call looks like on the wire

```text
 0:00  bot   Dialing Meridian Health Plan provider services.
 0:27  ivr   Estimated wait time is twenty minutes.
       ...................... 19m 40s on hold ......................
20:07  rep   Thanks for holding, this is Marcus with Meridian provider services.
20:15  bot   This is an AI assistant calling for the billing office of Lakeshore
             Family Medicine. This call may be recorded for accuracy.
21:58  rep   That one processed and paid on August twenty first, one hundred
             forty two dollars and sixty cents.
22:32  bot   Could I have a reference number and your first name?
```

Four and a half minutes of conversation behind twenty minutes of hold. The hold is the product: it is the part a person cannot afford to do, and the only part a machine does not mind.

## 7. Storing the result

Before writing the transcript anywhere, remove the identifiers that were spoken. A member id read back digit by digit arrives as `W 8 8 4 2 1 3 0 9 7`, so an exact string search will miss it. Keep the claim numbers: those are what the biller works from.

The runnable app at [`apps/python/trunkline`](../../../apps/python/trunkline/) does this step, and ships a `vault-check` command that walks every file it wrote looking for identifiers that should not be there.
