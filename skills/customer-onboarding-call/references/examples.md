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
reachability: no-human — carrier message, no customer speech
structured result: none
follow-up: none
suppression: none
retry: attempt 2 of 3 scheduled after 30 minutes, within recipient working hours
```

What qualifies this as `not-reached` is the **carrier message**, not the missing result. The
transcript contains no customer speech, which is positive evidence nobody took part. Retrying is
safe here precisely because that evidence exists.

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

## Refusal with no structured result — still a refusal

The customer refused and rang off. The provider returned **no structured result at all**, because
the call ended before extraction ran.

Transcript:

```text
0s  agent     Hi Ada, this is Example Supply. Is now a good time for a quick welcome call?
3s  customer  No. Take me off your list.
5s  (call ends)
```

Expected report:

```text
outcome: declined
phone: +1******1234
structured result: none
evidence: transcript — "take me off your list"
crm write: refusal and evidence only
follow-up: none
retry: none, pending retries cancelled, all outbound calling suppressed for this number
```

**This is the case that classifying on "is there a result" gets wrong.** A rule reading *no result
means nobody was reached* would mark this `not-reached` and schedule an automatic retry — redialling
someone who explicitly asked to be left alone, moments after they asked. Reachability comes from the
transcript, and refusal evidence outranks the missing result.

## Reached, but extraction produced nothing

A full conversation took place; the provider's extraction failed and returned no result. Nothing in
the transcript indicates a refusal.

```text
outcome: needs-review
phone: +1******1234
reachability: human — customer speech present in transcript
structured result: none (extraction failed)
crm write: raw record and transcript only
follow-up: none
retry: none, manual review required
```

The call is not retried. A human decides whether to re-extract from the transcript or to call again.
Automatically redialling someone who already gave a full interview — because a downstream extraction
step failed — wastes their time and risks contacting a customer who declined in words the classifier
never saw.

## Extractor says NotReached, but nothing observed agrees

The result claims nobody was there. The call evidence does not corroborate it: there is no
voicemail greeting, no carrier message, and no ring-out — just a short exchange the extractor
apparently discounted.

```json
{
  "consent_granted": false,
  "disposition": "NotReached",
  "disposition_evidence": "No response detected."
}
```

```text
0s  agent     Hi Ada, this is Example Supply. Is now a good time?
2s  customer  (inaudible)
4s  customer  ...no.
```

Expected report:

```text
outcome: needs-review
phone: +1******1234
reachability: indeterminate — extractor claimed NotReached, no corroborating no-human evidence
retry: none, manual review required
```

**`disposition: NotReached` is a model claim about the call, not an observation of it** — and it
comes from the same extractor that mislabels refusals. It may corroborate voicemail or carrier
evidence; it can never substitute for it. Here the transcript contains what may be a refusal, so
retrying on the extractor's word alone could redial someone who said no.

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

After reconciliation finds a matching charge for attempt key
`onboarding:<signup_id>:1:<digest>`, and the payload digest matches the number and script actually
dialled:

```text
outcome: needs-review
evidence: provider billed a call for this attempt key despite reporting failure
meaning: the call WAS placed; its outcome is unknown
retry: none — a human reads the provider record first
```

**A billing charge is evidence against a retry, not for one.** It shows the call happened, which
makes a conversation *more* likely, not less — the person may have answered and refused. Reading it
as "no result, so nobody answered" and redialling is exactly the mistake this workflow must not
make.

Only a definite negative releases a retry:

```text
reconcile: provider positively reports no call was ever placed for this attempt key
outcome: failed
retry: attempt 2 of 3 scheduled after 30 minutes
```

Had the workflow retried immediately on the failure report, the delayed original would have
arrived while the retry was in flight, and the customer would have been called twice.

## Lost webhook — a leased attempt must not strand the signup

The provider accepted the call, but the terminal webhook never arrived: it was sent during a
deploy. The attempt sits live, and because a live attempt blocks new ones, the signup would never
be called again.

The lease expires, so reconciliation asks the provider directly:

```text
attempt 1: live past its lease
reconcile: provider reports the call completed 12 minutes ago with a structured result
```

Expected handling:

```text
action: ingest the provider's result through the normal path
outcome: classified normally, Stage A then Stage B
retry: none, a conversation took place
note: the webhook was lost, not the call
```

If instead the provider is unreachable, or simply does not recognise the attempt key:

```text
outcome: needs-review
attempt: closed, signup released so it is no longer blocked
retry: none — releasing the slot is not authorisation to dial
```

An expired lease is a fact about **our bookkeeping**, not about the customer. The call may have
connected and been refused. So expiry resolves to a reconciled result, `ambiguous`, or
`needs-review` — never `not-reached`, and never a redial on its own.

Only a provider that positively confirms the call was never placed yields `failed`, which is the
one lease-expiry path that releases a retry.

## Attempt cap reached with a callback request

The customer asked to be called back, but this was already attempt 3 of 3.

```text
outcome: partial
callback consent: granted, "try me tomorrow morning"
retry: none, attempt cap reached
next: surfaced for manual handling, with the callback request and time attached
```

A callback request is permission to call, not additional budget. The cap is absolute, and the
request is handed to a human rather than silently dropped.

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
