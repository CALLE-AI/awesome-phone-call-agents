---
name: pharmacy-stock-check
description: Call a list of pharmacies to find out which one has a specific medication in stock, at what price, and whether they will hold it. Use when someone needs to locate a medication nearby and would otherwise ring round manually. Returns one structured record per pharmacy with a confidence score and the call transcript as evidence.
---

# Pharmacy stock check

Finding a medication that is actually in stock means calling pharmacies one at a
time and asking the same four questions. This skill does the calling and returns
a ranked answer.

It is a good fit for CALL-E's design: low-frequency, personal, high-stakes phone
work that was never worth automating with a traditional call platform.

## Before you start

**This skill places real phone calls to real businesses.** Confirm with the user:

- the medication, dosage and quantity
- which pharmacies to call, as E.164 numbers
- that they want calls placed now

Never infer a phone number. Never call a number the user did not supply or
approve.

## Safety boundaries

This skill gathers **availability and pricing information only**.

- It does not give medical advice, recommend a medication, or suggest a
  substitute. If a pharmacist offers an alternative, report it verbatim as
  something the pharmacist said — never as a recommendation.
- It does not place an order, reserve stock, or commit to a purchase on the
  user's behalf.
- It is not for emergencies. If someone needs medication urgently, they should
  contact emergency services or an urgent care provider, not wait on an agent.
- Prescription requirements are reported, never worked around.
- Report the pharmacist's answer and the confidence score. Do not present a
  low-confidence result as fact — the user may travel somewhere while unwell on
  the strength of it.

## Workflow

### 1. Collect the request

Required: medication name, dosage, quantity, recipient region, and the list of
pharmacy phone numbers in E.164 format.

If a number is local or ambiguous, ask the user for the full E.164 form. Do not
guess a country code.

### 2. Build the goal

CALL-E's MCP surface has no `result_schema` parameter, so the fields you want
must be named in the `goal` text. CALL-E honours them reliably and emits them in
`result.summary`.

```text
You are calling a pharmacy on behalf of a patient looking for a medication.
Identify yourself as an automated assistant immediately, and keep the call
brief and polite.

Find out whether they currently have {drug} {dosage} in stock. The patient
needs {quantity}.

Capture these fields in the structured result, using exactly these key names:
- in_stock: yes, no, partial, or unknown. Use partial if they have some but
  fewer than the patient needs.
- form_available: brand, generic, both, or unknown
- quantity_available: integer units they have
- unit_price: number, price per unit
- currency: three-letter currency code
- requires_prescription: yes, no, or unknown
- can_hold: yes, no, or unknown
- hold_duration_hours: number of hours they will hold it
- alternative_suggested: any alternative or other branch they mention
- pharmacist_notes: anything else useful, one short sentence

If they do not have it, still ask about alternatives or another branch. Do not
place an order or commit to anything on the patient's behalf. Thank them and
end the call. If nobody answers, report that the pharmacy could not be reached;
do not treat that as a successful stock check.
```

Identifying as an automated assistant in the first line is not optional. It is
the difference between a pharmacist answering and a pharmacist hanging up.

### 3. One run per pharmacy

`to_phones` accepts an array, but batching returns an **aggregated** summary for
the whole batch. This workflow needs per-pharmacy attribution — which pharmacy
has 10 units at £5 — so place one run per pharmacy and run them concurrently.
The call cost is identical.

### 4. Execute

```text
plan_call    → ready_to_run + confirm_token   (free, places no call)
run_call     → run_id                          (spends len(to_phones))
get_call_run → poll until terminal, following next_step.action
```

`plan_call` is free. Iterate on the goal text as much as you like before
spending anything.

### 5. Read the result

The extracted fields arrive in `result.summary` as `key=value` pairs, **not** in
`result.extracted` — see `references/calle-mcp-integration.md`. Values contain
commas, so split on `key=` boundaries rather than on commas.

Also read `result.outcome`, which gives `task_completed`, a confidence score and
specific evidence strings. Surface the confidence to the user.

### 6. Report

Rank in-stock first, then by price, then by whether they will hold it. Sink
low-confidence results below high-confidence ones: a reliable "no" is more
useful than an unreliable "yes" that sends someone across town.

Mask phone numbers in summaries — show the pharmacy name and the last four
digits.

Offer the transcript. Every claim should be checkable against what was said.

## Cost and safety controls

- **Count phones, not calls.** `to_phones` is an array, so one plan can spend N
  calls. Charge `len(to_phones)` against any budget before dialling.
- **Check the budget for the whole search up front**, so five pharmacies against
  three remaining calls fails before anything is dialled rather than halfway
  through.
- **`plan_id` is the idempotency key.** Never issue `run_call` twice for the
  same plan.
- **Persist every response immediately.** Never re-dial to recover data you
  already paid for.
- **No recurring schedules.** This is a one-shot workflow. If a user wants
  repeat checks, create them explicitly and tell the user how to cancel.

## Dry run

`scripts/pharmacy_search.py` is dry-run by default and prints the exact payload
it would send without placing a call. Live calls require `--live`.

```bash
python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv        # no calls
python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live # calls
```

## Example

Request: amoxicillin 500mg, 21 capsules, three pharmacies in GB.

Result from one pharmacy:

```json
{
  "pharmacy": "Test Pharmacy (…0100)",
  "in_stock": "partial",
  "quantity_available": 10,
  "unit_price": 5.0,
  "currency": "GBP",
  "requires_prescription": "yes",
  "can_hold": "yes",
  "hold_duration_hours": 48,
  "pharmacist_notes": "They have only 10 units available, less than the requested 21 capsules.",
  "confidence": 0.82
}
```

Worth noting what CALL-E got right there: the pharmacist said "10 units" against
a request for 21, and the result is `partial` rather than `yes`. It also
converted "just two days" into `hold_duration_hours: 48`.

## References

Read `references/calle-mcp-integration.md` for MCP surface behaviour, including
where extraction actually lands.

Read `references/safety.md` for boundaries on medical-adjacent phone workflows.

See `references/examples.md` for worked conversations, including when to decline
to call.
