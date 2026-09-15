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

The app places at most two calls: sender first, then receiver only after the sender has been reached, explicitly confirms a completed handoff, and supplies a valid case/reference. It never dials a number discovered during a call, never auto-redials after an ambiguous creation result, and stores the returned call ID before polling.

Authenticated CALL-E requests reject redirects instead of forwarding authorization or idempotency credentials to another location. E.164 destinations are validated as full-string ASCII numbers.

Structured results are treated as claims. Material evidence must be grounded by exact recipient transcript quotes. Reconciliation is advisory evidence processing, not an authoritative determination of fault, ownership, entitlement, or real-world completion. It returns explicit outcomes such as `ACKNOWLEDGED_MATCH`, `HANDOFF_NOT_ACKNOWLEDGED`, `OWNERSHIP_CONTRADICTION`, `REFERENCE_MISMATCH`, `SENDER_DENIES_HANDOFF`, or `UNKNOWN`.

Human-facing preview/result/error copies redact phone-like content embedded in subject, organization-name, or task/error text. The actual authorized destination remains bound separately to the validated request and is masked when displayed.

## Cancellation and recovery limits

A call accepted by the remote provider is already an external side effect. Stopping this local process does not prove that the remote call was canceled. This demo does not implement or claim guaranteed cancellation after remote acceptance. If creation or polling becomes ambiguous, use the saved call ID to reconcile the existing operation and do not redial automatically.

## Live proof ceiling

A bounded integration smoke reached CALL-E's real API, created one authorized call to CALL-E's official US English test hotline, and reconciled the saved call ID to terminal `completed` with `simulated=false`. Because the official hotline is not an actual handoff sender, the business-semantic result remained `UNKNOWN` instead of being promoted into a paired-handoff claim.

A real two-party handoff is not claimed by that smoke test.
