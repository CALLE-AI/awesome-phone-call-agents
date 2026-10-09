---
name: email-task-call-proposal
description: Turn explicit email, task, and calendar signals into an approval-gated phone follow-up proposal, using CALL-E only when a bounded appointment change genuinely requires a call.
license: MIT
---

# Email Task Call Proposal

This skill helps an assistant notice work in email, task, and calendar systems
that needs an external follow-up. It chooses the least surprising channel
available — an existing booking system, email, or phone — and creates a
structured proposal for a human to review. It does not place a call while
reading sources or drafting the proposal.

The intended host workflow is:

`email/task/calendar evidence → channel proposal → human approval → follow-up → structured result`

## Use this skill when

- an email, task, or calendar event explicitly asks for a callback,
  confirmation, reschedule, availability check, or another bounded follow-up;
- a calendar event needs to be reorganized and the original booking channel is
  known or can be inferred from direct source evidence; and
- the recipient and an exact contact method are present in the source or a
  directly matched contact record.

## Do not use this skill when

- the phone number or email address is missing, ambiguous, guessed, or found
  only in an unrelated contact record;
- the task can be completed safely by email, a draft, a calendar action, or a
  normal task update;
- the source does not establish why this recipient should be called;
- the user has not approved the proposal; or
- the call would require making a legal, medical, financial, purchasing, or
  other consequential decision on the user's behalf.

## Channel selection

When a user asks to reorganize or reschedule an event, inspect how it was
originally arranged before choosing a channel:

1. Check durable channel memory for the exact person/business and situation
   first. A specific memory such as "reschedule appointment → phone" overrides
   a general preference, but never apply a memory to a merely similar business.
2. Use the original booking system when the event contains a supported booking
   link or provider identifier.
3. Use email when the source thread or directly matched contact has an email
   address and the business normally handles changes there.
4. Use CALL-E when the business has no usable email or booking workflow, the
   source/contact has an explicit phone number, and the requested change can be
   stated as one bounded call goal. A phone-only salon or barber is a canonical
   example.
5. If more than one channel is plausible, present the choice in the proposal
   instead of silently trying several channels. Never create duplicate email
   and phone follow-ups for the same event without separate approval.

When the source explicitly establishes a channel, the host may save that
fact with its channel-memory tool. Include the source reference and the
situation, and update a matching memory rather than creating a duplicate. Do
not save an inferred preference.

## Proposal workflow

1. Read the bounded email/task/calendar context and identify the exact source
   event or work item.
2. Match the recipient only to a directly relevant contact or an explicit
   address/number in the source. Never infer contact details from a name.
3. Create one channel-specific proposal. For a call, use `call_task` and
   include the source reference, recipient, explicit phone number, reason, call
   goal, and expected result fields.
4. Show the user the proposed channel, source event, requested change, and a
   masked phone number when applicable. Keep the proposal pending until the
   user explicitly approves it.
5. After approval, the host calls CALL-E through its authenticated server SDK
   or Developer API. Use an idempotency key derived from the proposal id.
6. Poll or receive the CALL-E result until it reaches a terminal state. Record
   the CALL-E call id, terminal status, summary, and structured result.
7. Treat `no_answer`, `voicemail`, `unclear`, rejection, timeout, and ambiguous
   outcomes as unresolved. Do not claim that the requested task was completed.
8. Create any follow-up calendar, email, or task mutation as a separate
   approval-gated proposal.

## Host contract

The host supplies the input evidence and implements proposal and execution
boundaries. See [references/proposal-contract.md](references/proposal-contract.md)
for portable proposal and result shapes.

CALL-E's server SDK and Developer API are supported integration paths for a
trusted backend. MCP may be used by a host that already has a secure,
authenticated MCP client, but it is not required for this workflow.

Read [references/safety.md](references/safety.md) and
[references/examples.md](references/examples.md) before using this skill.
