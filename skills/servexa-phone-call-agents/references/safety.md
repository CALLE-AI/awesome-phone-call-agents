# Phone Call Safety Reference

This reference applies to every SERVEXA phone-call change, including prompts, templates, call initiation, webhook processing, status synchronization, reports, and follow-ups.

## Intended Use And Authorization

Use SERVEXA for authorized customer-care conversations related to an organization's customer relationship. Before placing a call, verify the intended customer, phone number, objective, calling permission, permissible time, and any required consent or disclosure. The final initiate action is an authorization checkpoint; do not auto-initiate a call from a preview, page load, webhook, or background refresh.

## Customer Respect

- Use a professional, calm, and empathetic tone.
- Never shame, threaten, intimidate, or embarrass a customer about repayment or account status.
- Ask one relevant question at a time and allow the customer to answer.
- If the customer is busy, distressed, confused, or asks for a human, acknowledge it and follow the appropriate escalation or callback path.
- Do not pressure a customer into a payment promise.
- If the customer withdraws consent, opts out, or asks not to be contacted, stop the call workflow and do not retry without fresh authorization.

## Truthfulness

- Do not invent balances, account numbers, due dates, payment arrangements, policies, or eligibility.
- Use only information present in the customer record, the operator's instruction, or the verified call result.
- If information is missing or disputed, say that it requires verification by the organization.
- Do not present a model-generated summary as a verbatim transcript.
- Do not present a recommendation as a completed action.

## Prompt Boundaries

- Templates define an objective and useful context; they do not authorize unrelated data access or unsupported promises.
- Human-directed questions must be incorporated naturally and must not override safety, consent, or escalation behavior.
- Keep sensitive details to the minimum needed for the call objective.
- The agent must identify itself as SERVEXA Customer Care when the product flow requires it.
- The agent should confirm it is speaking with the intended customer before discussing account-specific information.

## Stopping And Cancellation

Stop the conversation and mark it for appropriate review when identity cannot be confirmed, the customer is unavailable after the permitted attempt, the customer asks to stop, consent is absent or withdrawn, a do-not-contact instruction is received, or the agent reaches a topic requiring human authority. The current client does not expose a live cancel-call control; cancellation must therefore be handled by the provider's supported cancellation mechanism or by stopping before initiation. Never claim that a cancellation succeeded unless CALL-E or the local call record confirms it.

Do not continue or retry after an opt-out, safety escalation, repeated failed identity check, or provider failure unless an authorized operator explicitly starts a new permitted workflow.

## Escalation Signals

Create or retain a human follow-up when the customer:

- disputes an amount or account record;
- reports unauthorized activity or a possible security issue;
- requests a human representative;
- expresses significant distress or a complaint requiring staff review;
- cannot understand the information being discussed;
- reports a situation requiring policy, legal, or account verification;
- needs a payment arrangement that the agent cannot authorize.

The agent must not make a commitment on behalf of the organization unless the relevant authority and data are explicitly available.

## Consent, Recording, And Privacy

- Obtain and communicate any consent or disclosure required by the organization's policy and the applicable jurisdiction before recording or processing a conversation.
- Follow the organization's rules for call timing, contact frequency, opt-outs, retention, and deletion.
- Do not log API keys, access tokens, service-role credentials, or unnecessary personal data.
- Mask phone numbers in summaries, examples, logs, and review notes unless a fictional reserved number is being used.
- Keep provider credentials server-side in Supabase Edge Functions.
- Use row-level security and the shared Supabase client as implemented; do not bypass access controls in client code.
- Treat webhook input as untrusted. Validate its shape, event ID, correlation ID, and terminal event type before side effects.
- Do not create hidden recurring schedules or duplicate jobs. A repeat contact must be an explicit, authorized follow-up with one clear owner and due time.

## High-Risk Topics

- Do not provide medical, legal, financial, or emergency advice beyond the verified customer-care objective and the organization's authority.
- Route medical, legal, emergency, fraud, safety, or other high-risk matters to an appropriately authorized human team.
- If a customer describes an emergency or immediate danger, stop the customer-care workflow and direct them to the appropriate local emergency service or human support channel according to organizational policy.

## Failure Handling

- A queued or initiated call is not a completed call.
- If CALL-E has not reached a terminal state, show a pending state and allow a later status refresh.
- If a call fails, preserve the failure state and explain that no reliable outcome was recorded.
- If no transcript is returned, say that the transcript is unavailable rather than reconstructing one.
- If structured-result validation fails, retain the provider failure or unknown outcome and route the record for review when appropriate.
- Handle duplicate webhook delivery without duplicate outcomes, activities, or follow-ups.
- Use `unknown` when the evidence is insufficient, contradictory, or unavailable. Unknown is a valid review state, not permission to infer a payment status or customer commitment.

## Preview And Dry Run

The current directed-call wizard provides a human review screen before initiation. It is a preview only: it does not call CALL-E, reserve a phone attempt, or guarantee a result. The repository does not implement a provider dry-run endpoint. Treat the final initiate action as the point at which authorization and live-call safeguards must have been satisfied.

## Review Checklist

Before shipping a phone-call change, verify:

- The call objective is explicit.
- The prompt cannot invent account or payment facts.
- The customer can request a human or stop the conversation.
- Escalation triggers are preserved.
- The call record can be correlated to the provider call.
- Terminal events are validated and idempotent.
- Reports distinguish summaries, transcripts, outcomes, and recommendations.
- Secrets remain outside the client bundle.
- Pending, failure, and unavailable states are visible.
