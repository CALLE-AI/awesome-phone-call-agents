---
name: pharmacy-cash-price
description: Call a retail pharmacy and ask what a drug costs in cash with no insurance, returning a structured price, the quantity it covers, or an explicit refusal. Use for price comparison across several pharmacies, never for anything involving a patient or a prescription.
---

# Ask a pharmacy for a cash price

A cash prescription price is not published anywhere and differs at every counter, so the
only way to learn one is to telephone and ask. This skill makes that one call and returns
a structured answer.

Use it once per pharmacy and compare the results yourself. It does not rank, recommend, or
decide anything.

## Before you call

You need three things, and you must not guess any of them:

- **The exact number to dial**, in E.164, that a person has authorized for this run. A
  public business listing is not authorization. Discovering a number and calling it are
  two separate decisions, and a human makes the second one.
- **The drug as a price list names it**: name, strength, form, and quantity. For example
  "metformin hcl, 500 mg, tablet, 30". Never a patient's regimen.
- **Who you are calling on behalf of**, named aloud in the first sentence.

## The call

Ask one question and accept the first clear answer:

> "What is your cash price, without insurance, for 30 metformin 500 mg tablets?"

Open by stating that you are an automated AI assistant, naming who you are calling for,
and that the call is recorded. CALL-E does not disclose this by itself and offers no
setting for it, so the disclosure exists only in the task text you send.

Handle the three things that actually happen on a pharmacy line:

- **A phone tree.** Navigate to the pharmacy counter, using the keypad when a menu asks.
- **A hold.** Wait. Do not hang up and do not talk over hold music.
- **A transfer.** Greet the new person, repeat the disclosure in one short sentence, and
  ask again.

## Boundaries

This is a retail price question, the same one a walk-in customer asks all day. Keep it
there.

- There is no patient and no prescription. If asked which patient this is for, say so.
- Never supply or request a prescription number, date of birth, or insurance details, and
  never invent them.
- Never give medical advice, describe symptoms, or suggest starting, stopping, or changing
  a medication.
- A refusal ends the call. Do not argue, ask twice, or offer to hold. Pharmacies that will
  not price by phone are a real and reportable result.

Read `references/safety.md` before enabling live calls.

## The answer

Send this as `recipient_result_schema` so the result is validated rather than parsed out
of a summary. Every uncertain field can answer `unknown`, because a schema with no way to
report uncertainty invites a fabricated number.

```json
{
  "type": "object",
  "required": ["answered_by", "quote_status", "cash_price_usd", "quantity_quoted", "notes"],
  "properties": {
    "answered_by": {"type": "string", "enum": ["human", "ivr", "voicemail", "unknown"]},
    "quote_status": {"type": "string", "enum": ["quoted", "refused", "not_stocked", "unknown"]},
    "cash_price_usd": {"type": "string"},
    "quantity_quoted": {"type": "string"},
    "requires_prescription_on_file": {"type": "string", "enum": ["yes", "no", "unknown"]},
    "is_generic": {"type": "string", "enum": ["generic", "brand", "unknown"]},
    "discount_program_mentioned": {"type": "string", "enum": ["yes", "no", "unknown"]},
    "notes": {"type": "string"}
  },
  "additionalProperties": false
}
```

Keep `summary`, `status`, `transcript` and `call_id` out of a recipient schema: the
platform reserves them and will reject the request.

## Reading the result

Three rules keep a comparison honest. See `references/examples.md` for worked cases.

1. **A price counts only if a dollar amount was said aloud for the quantity you asked
   about.** A quote for a different bottle size is a real answer to a different question.
   Report it, do not rescale it: ninety tablets are not three thirties.
2. **Keep refusals in the denominator.** "Seven of twelve pharmacies gave a price" is the
   finding. Dropping the other five turns an opacity result into a clean-looking average.
3. **A completed call is not an answered question.** A voicemail box returns
   `status: completed` with `task_completed: true`. Let `quote_status` decide.

## Judging a price

A price alone cannot be judged, only compared. To say whether one is high, join it to the
National Average Drug Acquisition Cost CMS publishes weekly, which is public and needs no
key:

```
https://data.medicaid.gov/api/1/datastore/query/{nadac_dataset_id}?limit=5
  &conditions[0][property]=ndc_description
  &conditions[0][operator]=starts with
  &conditions[0][value]=METFORMIN HCL 500 MG
```

Multiplying `nadac_per_unit` by the quantity gives a national benchmark for that bottle,
not what the pharmacy on the phone paid. NADAC is a survey average across pharmacy invoices
nationwide, so a given shop paid more or less depending on its wholesaler and its volume.

Report the retail price as a multiple of that benchmark, say in the same breath that the
benchmark is a national average rather than this pharmacy's invoice, and cite the effective
date, because the figure moves weekly. A multiple stated without that qualification reads
as a claim about one business's margin, which is not something a phone call can establish.
