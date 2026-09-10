# Persistent local Twilio demo receiver

This opt-in mode leaves the owned Twilio number on the webhook between calls.
It requires explicit operator approval, including acceptance of possible inbound-call charges.
This is not an authorization to make outbound CALL-E calls.

The PC must remain awake with both receiver and ngrok processes running. There
is no automatic return to Reject, including when the receiver is stopped. An
unavailable PC or tunnel makes the configured webhook unavailable.

## Session setup

Use the pinned Node/pnpm runtime and build `@muster/simulator-host`. Start the
session-owned ngrok tunnel to loopback port **43112**, with inspection disabled.
Set these environment references without exposing credential values:

- `RUNTIME_PROFILE=development`
- `SIMULATOR_PERSISTENT_WEBHOOK=true`
- `SIMULATOR_PUBLIC_BASE_URL` = the exact current ngrok HTTPS origin
- `TWILIO_ACCOUNT_SID_FILE`, `TWILIO_AUTH_TOKEN_FILE`, `TWILIO_NUMBER_SID_FILE`
- `TWILIO_TARGET_NUMBER_FILE` = the existing owned synthetic target reference

Run `corepack pnpm simulator:live-demo:webhook:start`. It starts the receiver,
compares local/public health instance identities, updates the number's voice and
status webhooks, and verifies their URLs and POST methods. The command does not
construct CALL-E or place any telephone call. If activation is blocked, the
receiver remains running because an uncertain provider update may have applied.

## Per-call operation

Keep the same public origin and set `SIMULATOR_PERSISTENT_WEBHOOK=true` for the
existing guarded one-call runner. Preflight verifies the live webhook rather than
Reject. The receiver forwards only signed Twilio routes to the per-call host at
loopback **43111**; the browser still uses the original local demo proxy.

After a call, the job finishes before the outer process closes its resources.
Cleanup closes per-call authority and the call host, but does not restore Reject
or stop the shared tunnel/receiver. The existing review screen remains separate.

When the per-call host is absent, the receiver speaks the normal synthetic report
for inbound calls. This idle response creates no Muster observation and is not
evidence that a live demo succeeded. Invalid signatures, wrong account/target,
active-host errors, and timeouts are not converted into successful reports.

## Stop and readiness

Stop the local receiver/tunnel only when finished using the phone endpoint.
Twilio remains configured to the webhook; switching back to Reject is an explicit
operator action, not automatic cleanup. Never claim call success from receiver
health or configuration read-back. Only a separately authorized call with complete
admissible evidence proves the end-to-end demo.
