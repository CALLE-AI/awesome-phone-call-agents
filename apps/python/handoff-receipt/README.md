# Handoff Receipt

Handoff Receipt verifies one narrow service-chain failure: one organization says a case was handed to another, but the customer cannot tell whether the receiver recognizes the same reference or owns the next action.

It is a standard-library Python app using the CALL-E Developer API. Preview mode makes no calls. Live mode requires explicit authorization for each exact E.164 destination and a separate operator confirmation.

## Run

```bash
cd apps/python/handoff-receipt
python handoff_receipt.py --request example_request.json
python -m unittest discover -s tests -v
```

Live mode:

```bash
export CALLE_API_KEY=...
python handoff_receipt.py --request request.json --live --confirm I_AUTHORIZE_UP_TO_TWO_CALLS --state private-state.json
```

The app places at most two calls: sender first, then receiver only if sender evidence supports a completed handoff. It never dials a number discovered during a call, never auto-redials after an ambiguous creation result, and stores the returned call ID before polling.

Structured results are treated as claims. Material evidence must be grounded by exact recipient transcript quotes. Conservative reconciliation returns explicit outcomes such as `ACKNOWLEDGED_MATCH`, `HANDOFF_NOT_ACKNOWLEDGED`, `OWNERSHIP_CONTRADICTION`, `REFERENCE_MISMATCH`, `SENDER_DENIES_HANDOFF`, or `UNKNOWN`.

## Safety and claim limits

Before a receiver call is allowed, sender evidence must positively show all of the following: the sender was reached, it explicitly claims the handoff is complete, and the supplied case/reference passes validation. `UNKNOWN` is never itself permission for the next side effect.

Destination phone numbers must be full-string ASCII E.164 values. Authenticated CALL-E requests reject redirects rather than forwarding bearer credentials or idempotency material to another location.

Human-facing output masks phone-like values found in names, subjects, tasks, and error text. Reconciliation is advisory evidence, not an authoritative statement about real-world case ownership.

Stopping this local process does not prove that a call already accepted by the remote provider has been canceled. The app makes no guaranteed remote-cancellation claim.

## Live proof ceiling

A bounded integration smoke reached CALL-E's real API, created one authorized call to CALL-E's official US English test hotline, and reconciled the saved call ID to terminal `completed` with `simulated=false`. Because the official hotline is not an actual handoff sender, the business-semantic result remained `UNKNOWN` instead of being promoted into a paired-handoff claim.

A real two-party handoff is not claimed by that smoke test.
