# PickupProof

CALL-E pickup recovery desk, created September 6, 2026. Separate original hackathon build.

## Run

Node 22.13+ and npm. `npm ci`, then `npx wrangler d1 execute site-creator-d1 --local --config wrangler.local.json --file drizzle/0000_wise_nitro.sql` once for a new local database. Start `npm run dev -- --port 3101`.

## Workflow

Create practice case → approve exact plan → synthetic conversation → evidence review → accept proposed window → export JSON receipt. D1 stores cases and audit trails. Practice results are a fixed, clearly labeled synthetic scenario; no AI or call is used in practice mode.

Live mode requires server-only CALLE_API_KEY, OPERATOR_TOKEN, and LIVE_CALLS_ENABLED=true. Never place keys in browser code. The operator token is entered in memory in the console. The default deployment remains private; live mode is disabled. Do not expose this single-operator prototype publicly without adding user accounts, quotas, and retention controls.

Live calls use the documented CALL-E REST API, an idempotency key, a durable compare-and-swap execution reservation, and persisted provider call ID. Ambiguous create responses are never automatically retried; reconcile them in the provider dashboard. Polling cannot reopen accepted cases. Provider results are untrusted; unsupported outcomes fall back to ambiguous. An accepted window is not a completed pickup.

## Verify

`node --experimental-strip-types --test tests/domain.test.mjs`

With the server running: `node --test tests/http.test.mjs`. HTTP tests create clearly named synthetic cases in the local database. `npx tsc --noEmit` and `npm run build` check the production source.

## Remaining submission work

Configure CALL-E developer account, validate the actual provider response contract using an explicitly authorized test recipient, record a <3-minute video, provide account email, and submit an upstream app PR. No live call or final hackathon submission has been made. This contribution provides a local no-call workflow and an opt-in live adapter.

Source: https://github.com/CALLE-AI/call-e-integrations (API contract reviewed September 6, 2026).


## Side effects and cancellation

Practice mode never makes a call. Live mode calls exactly the approved recipient, may incur provider charges, and sends the approved task to CALL-E. Cancel before execution using the Cancel action. Once execution starts, use the CALL-E dashboard to manage the call; the app will not redial. No recurring jobs are created. Live tests require explicit consent from the test recipient. Keep exported receipts private and mask phone numbers before sharing. This app handles pickup availability only, not medical, legal, financial, or emergency requests.
