# Examples

These examples show how `customer-onboarding-call` turns one signup into one call, one structured
result, and at most one follow-up task.

The phone numbers in these examples use reserved fictional 555-01xx numbers.

## Successful Onboarding Call

Signup event:

```json
{
  "customerName": "Ada",
  "businessName": "Example Grocery",
  "phoneNumber": "+15550101234",
  "companyName": "Example Supply",
  "companyDescription": "a procurement platform that helps small businesses buy inventory with flexible payment options"
}
```

Conversation shape, abbreviated:

```text
agent     Hi Ada, this is Example Supply. Is now a good time for a quick two-minute welcome call?
customer  Yes, that's fine.
agent     What type of business do you run?
customer  We sell groceries.
agent     What made you sign up?
customer  I want more people to buy from us online, not just in the shop.
agent     Have you used a similar platform before?
customer  No, I haven't.
agent     Would you like someone to follow up and help with your first order?
customer  Yes, that would be great.
```

Structured result:

```json
{
  "business_type": "Retail Grocery",
  "goal": "Reach more customers who order online rather than in person.",
  "pain_points": ["Online orders are a small share of total sales."],
  "used_similar_before": false,
  "sentiment": "Positive",
  "activation_status": "NeedsHumanFollowUp",
  "wants_human_contact": true,
  "follow_up_required": true,
  "notes": "Asked for help placing a first order."
}
```

Expected report:

```text
outcome: onboarded
phone: +1******1234
business type: Retail Grocery
sentiment: Positive
activation: NeedsHumanFollowUp
follow-up: created, customer agreed to a human follow-up for their first order
retry: none
```

Note that the customer never said "needs human follow-up". They agreed when the agent offered.
Mapping that agreement to a field and then to an assigned task is the point of the workflow.

## Not Reached

The call reached a terminal state, but the agent heard a carrier message rather than a person.
No structured result was returned.

Transcript:

```text
0s  agent     Hi Ada, this is Example Supply.
4s  customer  All circuits are busy now. Please try again later.
```

Expected report:

```text
outcome: not-reached
phone: +1******1234
structured result: none
follow-up: none
retry: attempt 2 of 3 scheduled after 30 minutes, within recipient working hours
```

This must not be reported as an onboarding. A signup that displays as onboarded but was never
reached is worse than a visible failure, because nobody follows up.

## Declined

The customer answered and refused the call.

```text
agent     Is now a good time for a quick two-minute welcome call?
customer  No, please don't call me about this.
```

Expected report:

```text
outcome: declined
phone: +1******1234
follow-up: none
retry: none, future onboarding calls suppressed for this number
```

Discovery must stop immediately. Do not treat the refusal as an objection to answer.

## Missing Phone Number

Signup event:

```json
{
  "customerName": "Ada",
  "companyName": "Example Supply"
}
```

Required response:

```text
status: not called
blocker: phoneNumber is missing
needed: an E.164 phone number supplied by the customer at signup
```

Do not infer a number or country code from the customer's name, locale, or email domain.

## Duplicate Suppression

A second signup webhook arrives for a customer who already completed an onboarding call.

```text
status: not called
blocker: customer already has an onboarding call with a structured result
needed: explicit user instruction to call this customer again
```

Webhook delivery is at-least-once. Without this check, one signup becomes two calls to the same
person.
