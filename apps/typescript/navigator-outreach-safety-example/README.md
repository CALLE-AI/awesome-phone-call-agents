# Navigator Outreach — safety-locked CALL-E example

> **Proposed public contribution — review copy only. Not published or submitted.**

This small educational example shows how a project can verify that the CALL-E SDK is available at runtime while maintaining a permanent mock/no-call posture. It is a public-safe companion to a separate private Navigator Outreach project; it is **not** the private project, a deployment, or a live-call tool.

## What it does

- Imports `@call-e/calle` at runtime.
- Enforces four fail-closed controls: execution disabled, GO disabled, maximum calls zero, and shutdown active.
- Runs a fictional, local mock-guard result with no recipient, credential, endpoint, or transport.
- Provides tests demonstrating that any attempt to weaken the four controls is rejected.

## What it cannot do

This package contains no CALL-E client instantiation, endpoint configuration, phone-number handling, call creation, call scheduling, call dispatch, retry logic, or network transport. It does not accept, store, transmit, or use API keys; any supplied `CALLE_API_KEY` is rejected. It cannot place a phone call.

## Install and verify

See [INSTALL.md](INSTALL.md). The default verification is offline/no-call and requires no credentials.

## Safeguards

See [SAFEGUARDS.md](SAFEGUARDS.md). Do not add credentials or live-call capability to this example. Any production or live-call work must be separately designed, privately reviewed, and explicitly authorized.

## Verification visuals

The fictional, redacted verification panels in [docs/screenshots](docs/screenshots) show the intended evidence format. They are not evidence of a live call.

## License scope

The [MIT License](LICENSE) applies only to the files within this proposed public package directory. It does not apply to any private Navigator Outreach materials, records, procedures, credentials, or other content outside this directory.
