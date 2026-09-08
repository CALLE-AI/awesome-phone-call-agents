# CALL-E SDK smoke-test evidence

This project has two separate verification layers:

1. The public smoke test exercises the deployed fake-only application end to end.
2. The SDK contract smoke test exercises the live adapter with a local HTTP fixture, so it can verify the documented CALL-E request and response shapes without placing a phone call.

## Command

From the project root:

```bash
npm run test:calle
```

The test instantiates the real `@call-e/calle` TypeScript SDK through `CalleApiProvider` and intercepts its HTTP requests with a deterministic fixture. It verifies:

- `POST /v1/calls` is authenticated, carries the stable idempotency key, and accepts a `201` response.
- `GET /v1/calls/{call_id}` accepts a `200` response and maps status, structured result, evidence, and transcript turns.
- `GET /v1/calls/{call_id}/events` accepts a `200` response and maps the event list.
- The provider preserves the server-only API-key boundary and the adapter's public result shape.
- No network request reaches CALL-E and no phone call is placed.

## Recorded result

Verified on 2026-09-04:

```text
{"ok":true,"test":"CALL-E SDK contract smoke test","sdk":"@call-e/calle","realCallPlaced":false,"responses":{"create":201,"get":200,"events":200},"requests":[{"method":"POST","path":"/v1/calls"},{"method":"GET","path":"/v1/calls/call_smoke_123"},{"method":"GET","path":"/v1/calls/call_smoke_123/events"}]}
```

The full application verification also passed:

```text
npm test          5 files / 29 tests passed
npm run lint      passed
npm run build     passed
npm run test:public  {"ok":true,"scenarios":14,"matrixCases":12,"finalJobs":0}
```

## What this proves and what it does not

This evidence proves that the application uses the official SDK and that its live adapter is compatible with the documented create, status, and events contracts. It does not prove carrier delivery, account quota, destination-region support, or a real recipient's response. Those require one authorized live test number and an explicitly enabled server-side environment. The public deployment intentionally remains fake-only and free to test.
