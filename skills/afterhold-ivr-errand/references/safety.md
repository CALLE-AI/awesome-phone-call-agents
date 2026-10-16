# Safety

## Defaults

- The server runs in mock mode (`CALLE_MOCK=1`). No call is placed and no CALL-E key is needed.
- The server binds to `127.0.0.1`.
- `dry-run.mjs` refuses to run against a non-loopback server or a server that reports `mock: false`.

## Before a live call

A live call needs all of: `CALLE_MOCK=0`, a real `CALLE_API_KEY`, a real `JWT_SECRET`, an
allowlisted destination, a mission `region`, and `confirm_live: true` on that run's `/start`.
`run-mission.mjs` additionally requires `AFTERHOLD_CONFIRM_LIVE=1` when the server is live.

Only call numbers whose owners have authorized the call. The allowlist is the operator's
attestation; AfterHold does not verify it.

## Credentials

- `CALLE_API_KEY` is held by the server only and is only sent to
  `https://api.heycall-e.com` or `https://test-api.heycall-e.com`. Redirects are not followed.
- `AFTERHOLD_JWT` is only sent to the approved `AFTERHOLD_API_BASE` origin (https, or loopback).
- Public example secrets are rejected at boot. Never commit a `.env`.

## Hard refusals in every task string

Do not make or accept any payment, transfer or financial commitment. Do not give medical, legal or
tax advice. Do not cancel, close or destroy any account, subscription or legal record. If the callee
asks for a commitment, return `needs_human` and stop.

## Scheduling and quiet hours

`schedule_at` is a real future time, checked against quiet hours at that time, and every gate is
re-checked when the call comes due. A schedule is never a way to dial immediately.

## Ambiguous outcomes

If a create request may have reached CALL-E (timeout, dropped connection, 5xx), the mission is
`submission_unknown`. It is not retried and cannot be cloned until you check the CALL-E dashboard.

## Cancellation

Cancel is local. It stops tracking and prevents an unsent dial. It does **not** recall a call CALL-E
has accepted, and the API says so (`call_recalled: false`).

## Privacy

Phone-like numbers are masked in API responses, events, briefs, errors and worker logs. The
destination is always returned as a redacted E.164. Transcript evidence is truncated to 240
characters. Use fictional `555-01xx` numbers in samples.
