# Doot

Doot is a caller-first coordination demo for synthetic shelter and respite options. The browser softphone gathers a consented request, fixture provider activities produce two reversible demo holds, and the caller chooses one while the other is released. A separate, opt-in CALL-E rehearsal calls one authorized human-controlled number; it does not create a hold.

- Repository and setup: [kirmada1509/doot](https://github.com/kirmada1509/doot)
- License: MIT
- Runtime: browser, Node.js, Bun, Python voice runtime, Docker Compose

## Safe setup and use

Clone the Doot repository and follow its [fixture judge stack](https://github.com/kirmada1509/doot#fixture-judge-stack). Fixture mode needs no CALL-E account or telephone number and places no external calls. Open `/`, dial the displayed demo code, consent, submit a fixture request, and choose one of two explicitly labeled synthetic options. `/ops` shows source-labeled results and the release record. Run `pnpm test:acceptance` for browser coverage and `pnpm test:calle-rehearsal` for an isolated integration test against a local fake CALL-E API.

## Optional real call

An OIDC-authenticated operator can configure `CALL_E_API_KEY` and `CALL_E_DEMO_TARGET_E164` privately on the server. The target must be a phone number the operator controls and agrees to answer. In `/ops`, the operator confirms ownership and explicitly starts one rehearsal call for a case. Doot sends a one-recipient `POST /v1/calls` request with a stable idempotency key and a synthetic, nonbinding availability task. It polls authenticated `GET /v1/calls/{id}` for status, structured result, and transcript turns. A `201` acceptance or call ID is not proof of an answered conversation. The transcript is encrypted in Doot's audit archive; ordinary browser state exposes no full number, key, or transcript.

This optional action can ring a real phone and use CALL-E credits. It does not schedule recurring work, send SMS, or call real shelters or respite providers. The caller's fixture choice is not a real booking. Real AI-provider Goal Runs require separately published Goals, authorized answerer lines, and a validated release path; the project does not claim that those calls have been demonstrated.

## Cancellation and boundaries

Before the operator presses the call button, there is nothing to cancel. After CALL-E accepts a call, Doot does not claim it can recall a ringing or in-progress telephone call. The operator should end the live conversation if needed; a retry of uncertain acceptance reuses the same idempotency key rather than creating a new task. No real call is placed during the fixture path or automated tests. Doot is not emergency dispatch and does not reserve a real bed.
