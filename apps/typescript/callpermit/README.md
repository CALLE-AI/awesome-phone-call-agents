# CallPermit

CallPermit is a small, safety-first CALL-E app pattern: CALL-E handles the
conversation, while a Tethers-backed authority envelope defines the permission
slip before the call.

The app is bounded to one appointment offer: weekdays after 13:00, standard
service, maximum £60, and no extras, subscriptions, memberships, deposits,
purchases, or materially different commitments. `ALLOW` is the only decision
that reaches the CALL-E transport. `ASK` and `DENY` return a human Decision
Card instead.

## Try it without spending a call

The [source implementation](https://github.com/matthewjameswatkins1978-cyber/tethers-lang/tree/codex/callpermit-fake-module/hackathons/callpermit)
includes a deterministic fake transport and test suite:

```powershell
npm --prefix hackathons/callpermit run acceptance
npm --prefix hackathons/callpermit run dry-run
```

These commands make no network request and do not require credentials. The
official `@call-e/calle` 0.7.0 adapter is isolated from the default path; it
uses `CalleClient.calls.createAndWait`, a structured result schema, the
authority digest as metadata, and a deterministic idempotency key.

## Side effects and credentials

- No call is made merely because `CALLE_API_KEY` exists.
- A caller must construct the SDK adapter explicitly and supply credentials at
  the effect boundary.
- Only an explicitly approved controlled test number may be used for a live
  proof; no purchase or irreversible booking is permitted in the demo.
- A provider result is evidence, not authority. A result outside the envelope
  is never accepted as a successful commitment.
- A provider call ID survives timeout/restart; the app observes that identity
  rather than blindly dispatching a duplicate.

## Review scope

This is a pre-call permission and post-conversation reconciliation pattern. It
does not claim that Tethers interrupts or intercepts a live conversation.
