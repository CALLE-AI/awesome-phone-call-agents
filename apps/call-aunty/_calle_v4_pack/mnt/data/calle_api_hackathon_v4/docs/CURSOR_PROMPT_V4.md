# Cursor implementation prompt

Implement this V4 upgrade inside the existing `call-mobile-aunty` repository. First inspect the existing CALL-E client, Express routes, Drizzle schema, hooks, and tests. Do not create a second competing architecture. Merge the V4 modules into the existing architecture.

Requirements:
- keep `CALLE_API_KEY` server-side;
- use the official CALL-E endpoint and TypeScript SDK patterns already present in the repository;
- use `Idempotency-Key` for create retries;
- validate E.164 numbers;
- validate CALL-E-compatible result schemas;
- preserve `unknown` outcomes;
- persist calls/events/idempotency records using existing Drizzle conventions;
- deduplicate webhook events;
- reconcile missed webhooks with provider GET;
- add batch recipient support;
- expose safe status polling to React Native;
- add offline queue persistence using the app's existing storage solution;
- redact secrets and sensitive numeric tokens in logs;
- add tests without requiring a live CALL-E call;
- add one clearly gated live integration test that runs only when `CALLE_LIVE_TEST=true`;
- never print the API key;
- never hardcode a real recipient phone number;
- update README and demo instructions;
- ensure TypeScript and lint checks pass.

After implementation, run the project's existing test suite and fix integration issues rather than leaving duplicate route names or duplicate provider clients.
