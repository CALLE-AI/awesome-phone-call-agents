---
name: customer-onboarding-call
description: Place a one-off welcome and onboarding call to a customer who just signed up, capture a structured result such as business type, goal, pain points, sentiment, and activation status, then write that result back to a CRM and queue a human follow-up task when the customer asks for one.
license: MIT
---

# Customer Onboarding Call

Use this skill when a new signup should receive a short welcome call and the business wants the
conversation to end as structured data rather than as an unread recording.

`customer-onboarding-call` turns one signup event into exactly one outbound call, one structured
result, and at most one follow-up task. It does not create recurring schedules, call campaigns, or
contact lists. Recurrence, if the business wants it, belongs to the host scheduler; see
[`call-reminder`](../call-reminder/).

The workflow is deliberately narrow: welcome, consent, discovery, next-step offer, wrap-up. A call
that tries to sell, negotiate, collect payment, or resolve a support ticket is out of scope.

## When To Use

Use this skill for:

- welcoming a customer who just signed up and confirming they can get started
- collecting first-party onboarding context: business type, goal, prior tooling, blockers
- detecting whether a customer wants a human to follow up
- turning a spoken answer into a CRM field and an assigned task
- measuring activation coverage when a team cannot call every signup manually

## When Not To Use

Do not use this skill to:

- call people who did not sign up or otherwise ask to be contacted
- run sales, collections, renewal, or win-back calls
- deliver medical, legal, financial, or emergency instructions
- read pricing, delivery windows, contractual terms, or policy from memory
- retry indefinitely after a customer declines or asks not to be called
- re-call a customer who has already completed an onboarding call, unless the user explicitly asks

## Required Fields

For each call, require:

- `customerName`
- `phoneNumber` in E.164
- `companyName` for the agent to introduce itself as
- `companyDescription`, one sentence the agent may state as fact

Optional:

- `businessName`
- `locale` and `region` hints for the conversation

Ask for any missing required field. Do not infer a phone number, country code, or region from a
locale, an IP address, an email domain, or unrelated prior context.

## Core Workflow

1. Confirm the signup is real and recent, and that this customer has not already been called.
2. Build the call task from the required fields. Keep the script to roughly two minutes.
3. Attach a structured result schema so the provider returns fields, not just a transcript. See
   [`references/structured-result.md`](references/structured-result.md).
4. Place exactly one call, with an idempotency key derived from your own call record id.
5. Receive the terminal result on a webhook. Treat delivery as at-least-once and make ingestion
   idempotent.
6. Classify the outcome before writing anything. See *Outcome Classification* below.
7. Write the structured result to the CRM, then queue a follow-up task only when one is warranted.

Use this shape:

```text
signup -> call task + result schema -> one call -> terminal webhook -> classify -> CRM write -> follow-up
```

## Conversation Shape

Keep the call in this order. Allow interruption at any point.

1. **Greet and identify.** Name the customer, name the company, state that the call may be
   recorded if that is true in your jurisdiction.
2. **Ask consent.** Ask whether now is a good time for a short call. If the answer is no, offer to
   call back later and end. Do not continue discovery after a soft refusal.
3. **Discovery.** Ask what kind of business they run, why they signed up, what problem they want
   solved, and whether they have used something similar before. One question at a time.
4. **Offer the next step.** Invite the concrete first action, and offer a human if they prefer.
5. **Wrap up.** Summarize what will happen next, thank them, end.

The agent may answer only from `companyDescription` and any knowledge base you explicitly supply.
For anything else — price, delivery time, policy, availability — it must say it will have a human
follow up. Inventing these is the most common failure mode of onboarding-call agents.

## Outcome Classification

A call that reaches a terminal state has not necessarily reached a human. Providers commonly return
a completed call with an empty structured result when the agent talked to a carrier message,
voicemail, or silence.

Classify every terminal call into exactly one of:

| Outcome | Condition | Action |
| --- | --- | --- |
| `onboarded` | terminal and a structured result is present | write insight, queue follow-up only if requested |
| `not-reached` | terminal but no structured result | write no insight, queue a retry |
| `failed` | provider reported failure | write no insight, queue a retry |
| `declined` | customer refused the call or asked not to be contacted | write refusal, queue nothing, suppress future calls |

Never present `not-reached` as a success. A dropped signup that displays as onboarded is worse than
a visible failure, because nobody follows up.

## Retry Policy

International termination is unreliable in some corridors, and the same configuration can succeed
and then fail minutes later. See
[`references/international-routing.md`](references/international-routing.md).

Rules:

- Retry `not-reached` and `failed` outcomes. Do not retry `declined`.
- Cap retries at three attempts per signup.
- Space attempts by at least 30 minutes, and prefer local working hours for the recipient.
- Do not retry inside the recipient's night hours. A call at 01:40 local proves nothing about
  reachability; it only proves the person was asleep.
- Stop retrying once any attempt yields a structured result.

## Safety Rules

Read [`references/safety.md`](references/safety.md) for the full contract. Always:

- Treat every call as a real-world side effect with a cost.
- Call only the configured E.164 number, and only for a customer who signed up.
- Ask consent at the start of the call and honor refusal immediately and permanently.
- Mask phone numbers in summaries, dashboards, and logs.
- Never expose API keys, tokens, or webhook secrets in output.
- Never state pricing, delivery, policy, or legal or medical guidance from memory.
- Keep transcripts and recordings inside the systems the customer was told about.

## Output Format

After a call, report:

- outcome, one of `onboarded`, `not-reached`, `failed`, `declined`
- masked phone number
- structured result fields when present
- whether a follow-up task was created, and why
- retry decision and next attempt window when applicable

If no call was placed, report `status: not called`, the exact blocker, and what the user must
supply next. Never claim a call happened, or that a customer was onboarded, unless a structured
result exists to support it.
