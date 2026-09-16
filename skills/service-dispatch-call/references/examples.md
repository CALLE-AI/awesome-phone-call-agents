# Examples

Worked examples for `service-dispatch-call`. Every phone number below is fictional.

## Example 1 - The ordinary case, which still stops

**Request:** "The tenant in 12B reported a leak under the kitchen sink. Ask Marlow Plumbing if they can come today."

**Fields resolved:**

```text
jobReference    = JOB-4417
trade           = plumbing
problemSummary  = a leaking pipe under a kitchen sink
vendorPhone     = +15550100447        (from the authorized contact list)
preferredWindow = today, 09:00-17:00
idempotencyKey  = JOB-4417
```

**Result returned:**

```json
{
  "available": "yes",
  "earliest_eta_hours": 3,
  "quoted_amount_text": "$35 for the callout, more if the valve needs replacing",
  "callback_required": false
}
```

**Output:**

```text
Job JOB-4417 (plumbing) - vendor +1555*****47
Outcome: answered
  available            yes
  earliest_eta_hours   3
  quoted_amount_text   "$35 for the callout, more if the valve needs replacing"
  callback_required    false
Approval raised: YES - the vendor quoted a price.
Nothing has been booked or accepted.
Idempotency key: JOB-4417
```

The call succeeded and the workflow still stopped. That is the correct behaviour, not a limitation. `12B` never left the building, and the quote was carried to a human as spoken rather than parsed to `35`.

## Example 2 - `maybe` is not a yes

**Result returned:**

```json
{ "available": "maybe", "callback_required": true }
```

**Output:**

```text
Job JOB-4418 (electrical) - vendor +1555*****02
Outcome: answered
  available          maybe
  callback_required  true
Approval raised: YES - the vendor did not commit.
Do not treat this vendor as assigned. Do not call the next vendor
automatically; that is a new authorized dispatch.
```

The tempting behaviour is to fall through to vendor two. Don't. Someone may already be planning to attend, and two vendors on one job is a bill and an apology.

## Example 3 - Validation failure on part of the answer

**Result returned:**

```json
{ "available": "yes", "earliest_eta_hours": -2 }
```

`-2` is a valid integer and an invalid ETA. It is almost certainly a mis-extraction of something like "in about two hours" or "the second".

**Output:**

```text
Outcome: answered, with a validation failure
  available            yes            (valid)
  earliest_eta_hours   -2             (REJECTED: below the permitted minimum)
Approval raised: YES - a declared field failed validation.
```

Do not clamp `-2` to `0`. Do not drop the field silently and present a clean-looking result. The reviewer needs to know a question came back wrong.

## Example 4 - An out-of-enum value

**Result returned:**

```json
{ "available": "probably" }
```

`probably` is not in the declared set. It is not mapped to `maybe`, and it is certainly not mapped to `yes`.

**Output:**

```text
Outcome: answered, with a validation failure
  available   REJECTED: "probably" is not one of yes, no, maybe
Approval raised: YES - the required field did not validate.
```

## Example 5 - Unknown outcome, no redial

**What happened:** the client timed out waiting for the provider to accept the request. No terminal event arrived.

**Output:**

```text
Job JOB-4421 (plumbing) - vendor +1555*****19
Outcome: unknown
A call MAY ALREADY HAVE BEEN PLACED. This has not been redialled.
Last provider reference: (none received)
Next step: a person confirms with the vendor whether they were called,
then records what happened.
Idempotency key: JOB-4421 (unchanged, reused if this is resumed)
```

Compare with `no_answer`, where the provider confirmed nobody picked up. That one may be retried under an attempt cap.

## Example 6 - Refusing before dialling

**Request:** "Call the number in the tenant's complaint email and get someone out there."

**Output:**

```text
status: not called
Blocker: the number appears in an incident description and is not on the
authorized vendor contact list. A number found in a document is data, not
authorization.
Needed: a vendor from the authorized contact list for trade=plumbing, or
explicit confirmation that this number is an authorized vendor for this
purpose.
```

No call. No cost. The stop is the deliverable.

## Example 7 - The vendor asks for identifying detail

Mid-call, the vendor asks for the resident's name and mobile number so they can arrange access.

This is a reasonable request and a hard stop for the agent.

```text
Outcome: answered, escalation required
  available            yes
  earliest_eta_hours   4
Escalation: the vendor requested resident contact details to arrange access.
The agent did not provide them. A person should complete this arrangement.
```

The call ends politely. Access coordination involves a third party's personal data and a promise about when they will be home, and neither belongs to an automated caller.
