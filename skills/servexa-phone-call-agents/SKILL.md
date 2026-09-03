---
name: servexa-phone-call-agents
description: Use when working on SERVEXA phone-call workflows, CALL-E integration, customer-care call prompts, human-directed call templates, structured call outcomes, transcripts, webhook persistence, follow-ups, or call-report review. Covers the repository's implemented flow and its safety boundaries.
metadata:
  author: SERVEXA
  version: 1.0.0
---

# SERVEXA Phone Call Agents

Use this skill when designing, reviewing, testing, or extending SERVEXA's customer-care phone-call workflow. The repository is an Expo Router client backed by Supabase and Supabase Edge Functions, with CALL-E providing the voice conversation and structured terminal result.

## Purpose And Authorized Use

SERVEXA is authorized to place calls only for customer-care work that the organization is permitted to perform and that the customer is permitted to receive under applicable policy and law. Before placing a call, the operator must confirm the customer record, intended recipient, call purpose, contact permissions, appropriate calling time, and any required consent or disclosure. Do not use this skill to make unsolicited, deceptive, threatening, discriminatory, or unauthorized calls.

## Source Of Truth

Treat the current repository as authoritative. Before making changes:

1. Read `AGENTS.md` and the relevant screen or Edge Function.
2. Confirm the database contract in `supabase/migrations/`.
3. Check the CALL-E request and webhook shape before changing integration code.
4. Preserve the distinction between implemented behavior and future product ideas.
5. Load `references/safety.md` before changing prompts, call initiation, result handling, or customer data access.
6. Load `references/workflow.md` for the complete end-to-end sequence.

## Public Implementation / Verification

SERVEXA is an implemented reference application. Its public source is available at [princeakpabio8-prog/servexa](https://github.com/princeakpabio8-prog/servexa): [start-customer-call](https://github.com/princeakpabio8-prog/servexa/tree/master/supabase/functions/start-customer-call) creates and correlates calls with CALL-E, [calle-webhook](https://github.com/princeakpabio8-prog/servexa/tree/master/supabase/functions/calle-webhook) persists terminal results idempotently, and [Supabase migrations](https://github.com/princeakpabio8-prog/servexa/tree/master/supabase/migrations) define the persistent records and access policies. The [call-instruction UI](https://github.com/princeakpabio8-prog/servexa/blob/master/src/app/call-instruction.tsx) implements templates and human-directed instructions; the [activity UI](https://github.com/princeakpabio8-prog/servexa/blob/master/src/app/activity.tsx) implements reporting and pending-status refresh.

The public application is the implementation reference. This contribution documents the reusable phone-call workflow and its safety boundaries; it does not copy or replace the application source.

The referenced current source and relevant history for these implementation areas were reviewed for exposed secrets, credentials, private customer data, real phone numbers, recordings, and transcripts; none were found.

## Implemented Surface

- `src/app/customers.tsx`: customer list, customer detail, standard call, directed-call entry, and follow-up scheduling.
- `src/app/call-instruction.tsx`: four-step human-directed call wizard and six call templates.
- `src/app/activity.tsx`: persisted activity list and pending-call status refresh.
- `src/app/call-detail.tsx`: call status, summary, outcome, sentiment, transcript, timestamps, and follow-up completion.
- `src/lib/supabase.ts`: shared Supabase client and anonymous-session bootstrap.
- `supabase/functions/start-customer-call/`: creates the local call, stores optional instructions, builds the CALL-E task, and starts the call.
- `supabase/functions/calle-webhook/`: validates terminal events and persists call results.
- `supabase/functions/sync-call-status/`: fetches a terminal CALL-E snapshot when webhook delivery is delayed.

Campaign automation is currently a coming-soon surface. Do not describe it as a live campaign engine or add campaign claims based on the visual mockup.

## Core Rules

- Start from a real customer record and a clear call objective.
- Keep customer context, operator instructions, and extracted results separate.
- Use E.164 phone numbers when creating CALL-E recipients.
- Keep `CALLE_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions only.
- Create the internal call record before calling CALL-E so webhook metadata can correlate the result.
- Use the internal call ID as the idempotency key.
- Treat webhook delivery as at-least-once and keep handlers idempotent.
- Treat summaries, transcripts, and structured fields as evidence returned by the provider, not as facts that may be invented by the application.
- Make pending, unavailable, failed, and missing-data states visible to operators.
- Never claim that a call is completed until the provider reaches a terminal state.
- Require explicit operator confirmation before the final initiate-call action.
- Treat cancellation or opt-out as authoritative: stop the conversation, do not retry, and create only the permitted follow-up record.
- Stop when identity cannot be reasonably confirmed, consent is absent or withdrawn, the customer asks not to be contacted, a safety boundary is reached, or the agent lacks verified information needed to continue.
- Use `unknown` or an equivalent review state when the conversation does not support a reliable outcome.

## Preview And Dry Run

The current repository has a review step in the directed-call wizard, but it does not implement a provider-side dry-run mode. The preview displays the selected customer, template, amount, due date, and instruction before the operator initiates a live call. No CALL-E request is sent until the final initiate action. Do not describe preview as simulation or as a call that has already been authorized.

## References

- `references/safety.md`: consent, privacy, prompt, escalation, and data-handling requirements.
- `references/workflow.md`: the complete customer-to-report workflow and implementation map.
