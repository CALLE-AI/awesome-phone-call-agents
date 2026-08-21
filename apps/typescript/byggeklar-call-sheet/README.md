# Byggeklar Call Sheet

Construction teams lose time when a quote says "available" but does not establish the full quantity, delivery date, excluded handling fees, or substitutions. Byggeklar Call Sheet turns one authorized supplier-readiness check into an inspectable CALL-E task and a structured evidence packet. It never places an order or accepts a commercial change.

## Why this is phone work

Small and regional suppliers often resolve stock and delivery exceptions by phone. The workflow asks a bounded set of project-specific questions, reads the answers back once, and returns evidence for a person to review. A voicemail, refusal, partial answer, substitution, fee or ambiguous date never becomes an approval.

## Safety model

- `preview` never contacts CALL-E or a recipient. It prints the exact task, masked destination, boundaries and a SHA-256 approval receipt.
- `call` refuses unless `--confirm` exactly matches the current preview receipt. Editing any call detail invalidates approval.
- The request must record contact consent or authorization and use a currently supported CALL-E region.
- One stable idempotency key prevents a retry from creating a duplicate call.
- The task prohibits negotiation, orders, substitutions, fee acceptance and unrelated disclosure.
- The API key can only be sent to `https://api.heycall-e.com`.
- Live reports are written with owner-only permissions and remain local.

## Try it without a call

Node 22 or later:

```bash
cd apps/typescript/byggeklar-call-sheet
npm install
npm run check
npm test
npm run demo
```

`npm run demo` uses a clearly labelled fixture result. It performs no network request and places no call.

## Preview and run one authorized call

Replace the fictional example with an authorized contact in a CALL-E-supported region.

```bash
npm run preview
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run call -- --request examples/supplier-request.example.json \
  --confirm <receipt-from-preview> \
  --output reports/project-elm.json
```

The live path imports `@call-e/calle`, calls `client.calls.create(...)`, then polls the same call with `waitForResult(...)`. It does not contain a simulated success fallback.

## Result contract

The structured result keeps availability, delivery date, quote validity, excluded fees and substitutions separate. `human_review_required` remains explicit. Transcript evidence and provider confidence are retained in the private report; no answer is converted into an order.

## Cancellation and recovery

This app creates at most one call and no recurring job. Before `call`, stop by doing nothing. After CALL-E accepts a call, do not repeat the command with a new request ID: the stable idempotency key is designed to reconcile retries. Use the CALL-E dashboard for provider-supported cancellation and inspect the saved report before any procurement action.

## Limits

- The example number is fictional and must not be called.
- CALL-E does not currently list Denmark as a supported destination, so the validator refuses `DK` rather than silently routing it elsewhere.
- The workflow verifies statements made on the call; it does not verify the supplier's stock system, price, authority, identity or legal terms.
- No automated call should be placed without applicable consent, disclosure and calling-time compliance.
