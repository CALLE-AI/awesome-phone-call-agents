# Examples

These examples show how `customer-onboarding-call` turns one signup into at most one conversation,
one structured result, and at most one follow-up task — including the cases where it must write
nothing and create nothing.

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
  "consent_granted": true,
  "disposition": "Completed",
  "disposition_evidence": "Customer answered 'yes, that's fine' to the consent question and stayed to the end.",
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
suppression: none
retry: attempt 2 of 3 scheduled after 30 minutes, within recipient working hours
```

This must not be reported as an onboarding. A signup that displays as onboarded but was never
reached is worse than a visible failure, because nobody follows up.

## Voicemail — absence of consent is not refusal

The agent reached voicemail. The provider returned a result with `consent_granted: false`, because
nobody was there to grant consent.

```json
{
  "consent_granted": false,
  "disposition": "NotReached",
  "disposition_evidence": "Answered by voicemail greeting; no human spoke."
}
```

Expected report:

```text
outcome: not-reached
phone: +1******1234
suppression: none
retry: attempt 2 of 3 scheduled after 30 minutes
```

**This is the case a single ordered table gets wrong.** `consent_granted` is `false`, so a rule that
checks consent before establishing that a human took part would classify a routine voicemail as
`declined` and permanently suppress the number. Every customer who simply missed the call would be
silently lost. Stage A resolves `NotReached` before consent is ever read.

## Malformed result — review, never redial

A human clearly took part, but the consent fields are unusable: `disposition` is `Completed` while
the evidence shows the customer objecting.

```json
{
  "consent_granted": true,
  "disposition": "Completed",
  "disposition_evidence": "I said I'm not interested, stop calling."
}
```

Expected report:

```text
outcome: needs-review
phone: +1******1234
reason: disposition_evidence contradicts disposition
crm write: raw record only
follow-up: none
retry: none, manual review required
```

Coercing this to `not-reached` would queue an automatic retry and redial a customer who appears to
have refused. When consent is unreadable, a human decides — never another call.

## Declined, with a populated result

The customer answered and refused. The provider still returned a structured result, because it
inferred some fields from the signup context.

```text
agent     Is now a good time for a quick two-minute welcome call?
customer  No, please don't call me about this.
```

Structured result:

```json
{
  "consent_granted": false,
  "disposition": "DoNotCall",
  "disposition_evidence": "Customer said 'no, please don't call me about this' at the consent question.",
  "business_type": "Retail Grocery",
  "sentiment": "Neutral"
}
```

Expected report:

```text
outcome: declined
phone: +1******1234
disposition: DoNotCall
evidence: "no, please don't call me about this"
crm write: refusal and evidence only
follow-up: none
retry: none, pending retries cancelled, future onboarding calls suppressed for this number
```

**This is the case that classification on "a result exists" gets wrong.** A result is present and
`business_type` is populated, so a naive rule reports this as onboarded and creates a follow-up task
for someone who just asked to be left alone. Rule B1 exists to prevent exactly this. Discovery must stop immediately, and the refusal must not be treated as an objection to answer.

## Ended early

The customer consented, then hung up during discovery.

```text
agent     Is now a good time for a quick two-minute welcome call?
customer  Sure, go ahead.
agent     What type of business do you run?
customer  We sell groceries — sorry, I have to go.
```

Structured result:

```json
{
  "consent_granted": true,
  "disposition": "EndedEarly",
  "disposition_evidence": "Customer said 'sorry, I have to go' during discovery and ended the call.",
  "callback_consent": false,
  "business_type": "Retail Grocery"
}
```

Expected report:

```text
outcome: partial
phone: +1******1234
crm write: business type only, record marked partial
follow-up: none, the customer did not ask for one
retry: none, a conversation took place and no callback was requested
next: manual review if the team wants to finish discovery
```

No follow-up task is created, and **no automatic retry is scheduled**. A `partial` is a
conversation, so the attempt budget is spent. The customer may have ended the call precisely
because they did not want to continue, and nothing in the transcript distinguishes that from a
dropped line.

## Ended early, with a callback request

Same shape, except the customer asked to be called back.

```text
customer  Sorry, I'm with a customer — can you call me back this afternoon?
```

```json
{
  "consent_granted": true,
  "disposition": "EndedEarly",
  "disposition_evidence": "Customer asked to continue later because they were serving a customer.",
  "callback_consent": true,
  "callback_consent_evidence": "Can you call me back this afternoon?",
  "business_type": "Retail Grocery"
}
```

Expected report:

```text
outcome: partial
phone: +1******1234
callback consent: granted, "can you call me back this afternoon?"
retry: attempt 2 of 3 scheduled this afternoon, local time, against the same cap
```

This is the only route to an automatic redial after a conversation: the customer asked, in their
own words, and the request is on record. The redial does not reset the attempt budget.

## Ambiguous failure, reconciled before retrying

The provider reported a failure with no dial timestamp. That is not proof no call was placed.

```text
attempt 1: provider reported failed, no dial timestamp, elevated API latency
```

Expected handling:

```text
outcome: ambiguous
retry: not scheduled yet
action: reconciliation check in 15 minutes against provider billing and platform call logs
```

After reconciliation finds a matching charge for idempotency key `onboarding:<signup_id>:1`:

```text
outcome: not-reached
evidence: provider billed a call for this idempotency key despite reporting failure
retry: attempt 2 of 3 scheduled after 30 minutes
```

Had the workflow retried immediately on the failure report, the delayed original would have
arrived while the retry was in flight, and the customer would have been called twice.

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
