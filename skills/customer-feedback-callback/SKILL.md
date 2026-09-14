---
name: customer-feedback-callback
description: Place one idempotent post-delivery CALL-E feedback call per order, extract a structured sentiment/missing-item result from the transcript, and route it through a multi-agent triage (feedback, investigation, trend) that recommends — but never auto-applies — an urgent business notification.
license: MIT
---

# Customer Feedback Callback

Use this skill when an agent needs to turn "call the customer after their order and see how it went" into a safe, repeatable workflow: one outbound CALL-E call per order, a structured result instead of a raw transcript, and a downstream decision step that a human still approves.

This is a **post-delivery feedback callback**, not a reminder, a sales call, or a collections call. It assumes the order/service already completed and the business wants a short, low-pressure check-in call.

## When To Use

Use this skill for:

- one feedback call per completed order or service visit, dispatched automatically (for example 30 minutes after delivery)
- extracting a structured result (satisfaction score, sentiment, missing items, free-text summary) from the call instead of hand-parsing a transcript downstream
- distinguishing "customer did not pick up" from "customer answered and had nothing wrong" so only real signal reaches a human
- feeding call results into a small agent pipeline that cross-checks a new complaint against order history and recent trend before flagging it as urgent
- keeping the final "notify the business now" decision as a recommendation, never an automatic action

## When Not To Use

Do not use this skill to:

- place the call before the order/service is actually complete
- retry a call that already reached the customer (`completed`, `voicemail`) — only `no_answer`/`failed` outcomes are retry-eligible, and only up to a small fixed attempt cap
- call about anything other than the specific completed order named in the task (no upsell, no collections, no marketing)
- auto-apply a discount, refund, or other compensation based on the call result — that always stays a separate, explicitly human-approved action
- store or forward the raw transcript to a human channel; only the structured result and a short generated summary should leave this workflow

## Core Workflow

```text
order completed -> place_call (idempotent) -> webhook result -> outcome
   -> completed: run triage agents -> (optional) recommend notify
   -> no_answer/failed: schedule one retry, then stop
   -> voicemail/canceled: stop, no retry
```

1. **Dispatch.** When an order is marked complete, place exactly one CALL-E call for it. Use an idempotency key derived from the order id (for example `order-{order_id}`), never a random value, so a duplicate dispatch trigger cannot create a second call for the same order.
2. **Task text.** Generate the call-task instruction in the customer's known or declared language: a short fixed greeting naming the business and the reason for the call, then let the customer speak freely about satisfaction, issues, or suggestions. Do not script leading questions.
3. **Structured result.** Request a `result_schema` from CALL-E instead of relying on transcript parsing, for example:

   ```json
   {
     "type": "object",
     "properties": {
       "satisfaction_score": { "type": "integer", "description": "1 to 5" },
       "sentiment": { "type": "string", "enum": ["positive", "neutral", "negative"] },
       "missing_items": { "type": "array", "items": { "type": "string" } },
       "customer_summary": { "type": "string" }
     },
     "required": ["sentiment", "customer_summary"],
     "additionalProperties": false
   }
   ```

4. **Outcome classification.** Normalize the CALL-E webhook payload into `completed / no_answer / voicemail / failed / canceled / in_progress` before doing anything else with it. Never treat `no_answer` as a conversation that happened, and never treat `voicemail` as a completed feedback capture.
5. **Retry.** Only `no_answer` and `failed` are retry-eligible, and only once, after a short fixed delay (for example 5 minutes). A second unreachable attempt stops the workflow — it does not loop.
6. **Triage on a completed call.** Fan the structured result out to a feedback-understanding step and, in parallel, an investigation step (does order/complaint history support this?) and a trend step (is this part of a rising pattern?). Reconcile both into one recommendation.
7. **Notify, don't act.** If triage concludes the issue is urgent, produce a short recommendation message for a human channel (for example a Telegram/Slack alert to the business). The workflow's own authority ends at "recommend" — it must never place an order correction, refund, or compensation call by itself.

See `references/examples.md` for a runnable-shaped code example and `references/safety.md` for the full safety checklist this skill must satisfy.
