# Safety boundary

This directory owns deterministic authorization, consent, phone validation, redaction and conversation boundaries. Model instructions improve conversation behavior, but they do not authorize an action.

`policy.ts` classifies read-only and side-effect tools. Only read-only tools may run automatically. `phone.ts` enforces strict ASCII E.164 at dispatch and masks phone numbers in summaries or operational text.

`authorization.ts` requires this sequence for every future side effect:

1. An authenticated server principal proposes the exact action, E.164 destination, purpose and bounded details.
2. The application presents the masked proposal and records an explicit confirmation from that same principal.
3. The adapter consumes the opaque authorization ID with the exact request. Any changed field, expiry, denial or reuse fails closed.

The current store is server-side, in-memory and suitable only for a single development process. A phrase spoken to the model, a search result or provider output cannot create an authorization record. SPA-007 must implement the `ActionAuthorizationStore` interface durably and bind `principalId` to authenticated family/senior identity before live side effects are enabled.

Do not put authorization IDs in logs or model-visible summaries. Log only the action, outcome, safe correlation ID and masked destination. The same side-effect workflow must also implement idempotency and reconciliation before dispatch.
