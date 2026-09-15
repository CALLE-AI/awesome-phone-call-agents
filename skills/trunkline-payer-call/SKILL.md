---
name: trunkline-payer-call
description: Call a health plan's provider-services line about a claim with CALL-E, disclosing only the minimum patient identifiers that workflow needs, and return a schema-checked answer whose every field is backed by a quote from the call transcript. Use for claim status, denial reason, prior authorization status, and eligibility.
license: MIT
---

# Trunkline payer call

A medical practice's billing office spends its day on hold with health plans asking four questions: what happened to this claim, why was it denied, where is this authorization, and is this patient covered. This skill compiles one of those questions into a CALL-E call task and checks the answer that comes back.

Two rules make it different from a general "call and ask" skill, and both are enforced before and after the call rather than requested in the prompt:

1. **Minimum necessary.** Each workflow declares the only patient identifiers it may disclose. Eligibility gets a member id and a date of birth. It does not get a name, because it does not need one.
2. **No answer without evidence.** Every field comes back with the representative's own words. If that quote is not in the transcript, the field becomes `unknown` and a person looks at it.

## When to use

Use this skill when a provider's billing office needs an administrative answer from a payer about a claim it has already submitted, and the answer is only available by phone.

## When not to use

Do not use this skill to call a patient, to file or withdraw an appeal, to agree to any amount or adjustment, to discuss clinical care, or to place a live call without explicit approval and a written authorization for that destination. Trunkline gathers and structures; people decide.

## Workflow

1. **Choose the workflow.** One of `claim_status`, `denial_reason`, `prior_auth_status`, `eligibility`. Read `references/schemas.md` for the closed result schema each one returns.
2. **Assemble the request.** Practice NPI, payer name and E.164 number, and one entry per claim: claim number, date of service, and a `patient` object holding that patient's identifiers.
3. **Build the plan and read it.** Run the preview below. It applies the disclosure envelope, drops every field the workflow may not disclose, and prints the exact task text and schema. It places no call.
4. **Confirm intent.** Show the operator the masked destination, the claims, and which identifier *field names* will be disclosed. Get explicit approval before dialling.
5. **Place the call** with `run_call`, or `POST /v1/calls` with the printed `task` and `result_schema` and an `Idempotency-Key`.
6. **Check the answer** with the `check` command. It validates the result against the schema locally and confirms every `evidence_quote` appears in the transcript. Anything it cannot confirm is reset to `unknown`.
7. **Scrub before storing.** Remove the patient identifiers from the transcript before it is written anywhere. Do not store a raw payer transcript.

Read `references/safety.md` before any live call.
Read `references/payer-playbook.md` for phone-menu, hold, and transfer handling.
Read `references/examples.md` for a worked request, task, and checked result.

## Preview and check, with no call placed

```bash
python3 scripts/build_call_plan.py preview --request references/example_request.json
python3 scripts/build_call_plan.py check --request references/example_request.json --result references/example_result.json
```

`preview` prints the task text, the closed result schema, and the field names it disclosed. `calls_placed` is always `0` on this path. `check` reports each claim as grounded or reset.

## Disclosure envelopes

| Workflow | May disclose |
| --- | --- |
| `claim_status` | member id, date of birth, patient last name |
| `denial_reason` | member id, date of birth, patient last name |
| `prior_auth_status` | member id, date of birth, patient last name |
| `eligibility` | member id, date of birth |

Never disclosed by any workflow: Social Security numbers or fragments, medical record numbers, home addresses, patient phone numbers, patient email. If a representative will not proceed without one, record what the billing office must supply and end the call.

## What the agent may never do on the call

- Open by stating it is an AI assistant calling for the provider's billing office, and say so again whenever asked.
- State that the call may be recorded before asking anything.
- Never file, withdraw, or escalate an appeal, reconsideration, grievance, or peer-to-peer review.
- Never accept, waive, negotiate, or dispute any amount, adjustment, refund, offset, or recoupment.
- Never agree to a corrected claim, a resubmission, or any change to a claim.
- Never give a Social Security number, full address, medical record number, card, or password.
- Never discuss diagnosis, treatment, or clinical care.
- Never guess. A value not clearly stated is `unknown`.
- Always ask for a call reference number and the representative's first name before ending.

## Safety

- Phone calls are real-world side effects. Require explicit user intent before any live call.
- Call published payer provider-services lines only. This skill never calls patients.
- Use E.164 numbers only, and mask them in every summary: `+12*******42`.
- Do not expose credentials. The CALL-E key belongs in the environment and goes only to the official API origin.
- Do not create hidden recurring schedules or duplicate jobs for the same claim. Send an `Idempotency-Key` and do not re-run a call whose result you have not yet read.
- Cancel by withholding approval or deleting the authorization for that payer. This skill never places a call on its own.
- Stay inside claim administration. Refuse medical, legal, financial, and emergency content.

## Related

A full runnable implementation, with bundling, hold accounting, a review console, a hash-chained audit log, and 102 offline tests, is at [`apps/python/trunkline`](../../apps/python/trunkline/).
