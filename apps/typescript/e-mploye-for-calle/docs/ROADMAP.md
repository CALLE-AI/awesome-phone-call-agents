# E-mploye for CALL-E roadmap

## Implemented base

- Independent Node.js 22+ repository.
- React/Vite English dashboard.
- Fake CALL-E provider by default.
- Live CALL-E provider through the official `@call-e/calle` SDK behind `CALLE_LIVE_ENABLED=true`.
- One virtual employee identity with three task templates: appointment desk, lead follow-up, and shift coordination.
- Recipient and scheduled context seed data using fictional reserved phone numbers.
- Preview → manager approval → provider call → status polling → structured result → human approval/rejection for every task template.
- Atomic JSON persistence, masked phone output, stable idempotency keys, visible failure states, safe retry, and fake cancellation.
- Tests for persistence, safety, provider request construction, workflow transitions, and cross-template execution.
- Repeatable three-scenario demo deck for judges, plus a selectable catalog of all three templates.
- Server-only live configuration contract, readiness health fields, and a **Live mode setup** panel; the public deployment remains fake-only.

## Delivery work

1. Run the controlled live CALL-E smoke test with a test number and account credentials.
2. Confirm current destination/locale support and tune the result schema against the live API.
3. Add optional webhook reconciliation if polling is insufficient for deployment.
4. [x] Add server-only secret configuration, live readiness reporting, and health checks.
5. Package the contribution at `apps/typescript/e-mploye-for-calle/` in the official repository.
6. Run the official validation script and create the contribution PR.
7. Record the public demo video and prepare the Devpost submission.

## Later product work

- Connect appointment templates to a calendar adapter.
- Connect lead follow-up to a CRM or inbox adapter.
- Connect shift coordination to a workforce scheduling adapter.
- Add optional webhook reconciliation when the deployment needs it.
- Support configurable business instructions without allowing credentials or sensitive data into call tasks.
