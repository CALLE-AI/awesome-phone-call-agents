# Examples

Worked examples for `call-the-parts`. Every phone number below is fictional (`+1555…`).

## Example 1 - Ordinary quote, still no purchase

**Request:** "Ask Hickory if they have a used radiator for a 2016 Civic."

**Fields resolved:**

```text
requestId    = PART-CIVIC-RAD-HICKORY
year/make/model = 2016 Honda Civic
part         = radiator
condition    = used
shopName     = Hickory Spare Parts
phone        = +15551234567
organization = Riverside Independent Auto
```

**Result:**

```json
{
  "in_stock": "yes",
  "condition_reported": "used, tested",
  "price_spoken": "eighty five plus core",
  "core_charge_spoken": "twenty five",
  "hold_offered": "yes",
  "hold_until_spoken": "until Friday",
  "pickup_or_ship": "pickup",
  "interchange_or_notes": "",
  "callback_required": false,
  "outcome": "answered"
}
```

**Output:**

```text
Request PART-CIVIC-RAD-HICKORY - Hickory Spare Parts +1555…4567
Outcome: answered
  in_stock              yes
  price_spoken          "eighty five plus core"
  hold_offered          yes
Human decision required: YES - a price and a hold were spoken.
Nothing has been purchased or held.
Idempotency key: PART-CIVIC-RAD-HICKORY
```

The call succeeded and the workflow still stopped. That is correct.

## Example 2 - `maybe` is not stock

**Result:**

```json
{ "in_stock": "maybe", "callback_required": true, "outcome": "answered" }
```

**Output:**

```text
Outcome: answered
  in_stock             maybe
  callback_required    true
Human decision required: YES - the spare parts shop did not confirm stock.
Do not call the next shop automatically. That is a new requestId.
```

## Example 3 - Out-of-enum value

**Result:**

```json
{ "in_stock": "probably", "outcome": "answered" }
```

**Output:**

```text
Outcome: answered, validation failure
  in_stock   REJECTED: "probably" is not one of yes, no, maybe, unknown
Human decision required: YES
```

Do not map `probably` to `yes`.

## Example 4 - Unknown outcome, no redial

**What happened:** the host timed out after `call start`. No terminal status.

**Output:**

```text
status: unknown
A call MAY ALREADY HAVE BEEN PLACED. This has not been redialled.
Next step: poll the same run_id, or a person asks the spare parts shop if they were called.
Idempotency key: PART-CIVIC-RAD-HICKORY (unchanged)
```

## Example 5 - Search hit is not authorization

**Request:** "I googled a spare parts shop, call the first number you see."

**Output:**

```text
status: not called
Blocker: a number from search results is not authorized for this request.
Needed: the user names the spare parts shop and confirms the E.164 number.
```

## Example 6 - Missing fitment

**Request:** "Call Hickory about a radiator."

**Output:**

```text
status: not called
Blocker: year, make, and model are missing.
Needed: the vehicle fitment before a preview is written.
```

## Example 7 - Shop asks to put it on a card

Mid-call the counter asks for a card to hold the part.

The agent does not provide payment details.

```text
Outcome: answered, escalation required
  in_stock       yes
  price_spoken   "eighty five"
Escalation: the spare parts shop asked for payment to hold the part.
The agent declined. A person at the dealership should call back if they want the hold.
```
