# Worked example

A full run against the bundled example: `examples/providers.csv` (three fictional clinics)
and `examples/healthcare.json` (the health-plan pack).

## 1. Build the plans

```bash
python3 scripts/plan.py examples/providers.csv --pack examples/healthcare.json
```

For `provider_101` this prints (abridged):

```json
{
  "record_id": "provider_101",
  "dial": "+12025550110",
  "goal": "You are an automated verification call on behalf of Northline Health. State at the start that this is an automated call ... 1. Does this office currently accept patients covered by the Northline Health plan? 2. Is this office currently accepting new patients? 3. Is this office still located at the address on file, 1420 Oak St, Suite 300? ...",
  "result_schema": { "type": "object", "required": ["accepts_plan", "accepting_new_patients", "address_current"], "properties": { "accepts_plan": { "type": "string", "enum": ["yes", "no", "unknown"] } } },
  "idempotency_key": "pcv:provider_101:healthcare@1"
}
```

The `dial` value is `+12025550110` because that is the number on the record - nothing else
can become the dial target.

## 2. Place the call

Using CALL-E: `auth status -> call plan (goal = the goal above, phone = +12025550110) ->`
show the plan to the user `-> call run -> call status` until terminal. You get a transcript.

Say the front desk answered:

```json
[
  {"speaker": "bot",  "text": "Automated verification call for Northline Health. Do you currently accept the Northline Health plan?"},
  {"speaker": "user", "text": "No, we stopped accepting that plan last month."},
  {"speaker": "bot",  "text": "Are you accepting new patients?"},
  {"speaker": "user", "text": "Yes, we are."}
]
```

## 3. Extract and resolve, per claim

`accepts_plan` - the recipient explicitly denied it. Copy the quote verbatim:

```bash
python3 scripts/verdict.py \
  --record '{"record_id":"provider_101","name":"Northline Family Clinic","phone":"+12025550110","claims":{"accepts_plan":true,"accepting_new_patients":true}}' \
  --pack examples/healthcare.json --claim accepts_plan \
  --transcript transcript.json \
  --extraction '{"answer":"no","evidence_span":"we stopped accepting that plan last month","source_role":"front_desk"}'
```

->

```json
{ "verdict": "MISMATCH", "evidence_span": "we stopped accepting that plan last month",
  "evaluation_reason": "Recipient statement (...) contradicts asserted True (observed False)." }
```

and a row is appended to `corrections.csv`.

`accepting_new_patients` - "Yes, we are." confirms the asserted `true`:

```bash
python3 scripts/verdict.py ... --claim accepting_new_patients \
  --extraction '{"answer":"yes","evidence_span":"Yes, we are.","source_role":"front_desk"}'
```

-> `MATCH`.

## The abstention case

Suppose the recipient had said "We take most major commercial plans." There is no quote
naming Northline Health, so:

```bash
python3 scripts/verdict.py ... --claim accepts_plan \
  --extraction '{"answer":"unknown","evidence_span":null}'
```

-> `UNCLEAR`, tag `AMBIGUOUS`, no correction. If you instead pass a quote that is not
present word-for-word in a recipient turn, `verdict.py` rejects it and still returns
`UNCLEAR` - it will not take your word for the answer without the exact sentence.

## Result

```
corrections.csv
record_id,claim_id,old_value,new_value,verdict,evidence,source,attested_at,expires_at
provider_101,accepts_plan,True,no,MISMATCH,we stopped accepting that plan last month,front_desk,...,...
```

Report to the user: provider_101 - `accepts_plan` MISMATCH (they dropped the plan last
month), `accepting_new_patients` MATCH. One correction written.
