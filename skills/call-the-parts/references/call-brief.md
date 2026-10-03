# Call Brief

The brief is the `--goal` given to CALL-E. It is what may be said, what must be asked, and where the call stops.

All phone numbers in this document are fictional.

## Structure

1. Disclosure — automated call, on whose behalf, why.
2. Reference — `requestId` only.
3. Fitment — year, make, model, part, condition.
4. Bounded questions that match the result schema.
5. Stop conditions.

## Template

```text
This is an automated call on behalf of {ORGANIZATION}.
I am checking used-part availability. Request {REQUEST_ID}.

I need to know whether you have a {CONDITION} {PART} for a {YEAR} {MAKE} {MODEL}.
If you need to check the shelves or a computer, I can wait.

Please tell me:
1. Do you have it in stock — yes, no, or you need to check and call back?
2. What condition is the part in, as you would describe it?
3. What is the price, as you say it, including any core charge?
4. Can you hold it, and until when?
5. Is it pickup, ship, or either?
6. If you do not have this exact part, is there an interchange you would use?

I cannot buy, hold, or pay on this call. Someone from {ORGANIZATION} will confirm.
If you would rather not get these calls, say so and I will end.

Extract only these fields:
in_stock (yes|no|maybe|unknown),
condition_reported, price_spoken, core_charge_spoken,
hold_offered (yes|no|unknown), hold_until_spoken,
pickup_or_ship (pickup|ship|either|unknown),
interchange_or_notes, callback_required,
outcome (answered|declined|no_answer|voicemail|unknown).
```

The closing line is not politeness. It removes any reading of the call as a purchase.

## Worked Example

```text
ORGANIZATION = Riverside Independent Auto
REQUEST_ID   = PART-CIVIC-RAD-HICKORY
YEAR         = 2016
MAKE         = Honda
MODEL        = Civic
PART         = radiator
CONDITION    = used
PHONE        = +15551234567   (fictional)
```

Not in the brief: the customer's name, their mobile, their address, their insurance claim.

## Rules

- Ask only what the schema declares.
- One idea per question.
- Do not offer a price ("would $80 work?").
- Do not authorize a hold.
- Set language and region from what the user said, not from the phone country code.
