# ParcelBridge

> **Disclosure.** ParcelBridge is a sanitized, self-contained reference app.
> The default demo is an **OFFLINE SYNTHETIC** MCP validation. It models the
> request and response shape used by a CALL-E client integration, but it does
> not contact a live CALL-E endpoint, place a real phone call, verify provider
> business semantics, or claim production readiness. See
> `docs/DISCLOSURE.md` for the complete claim contract.

## What It Does

ParcelBridge demonstrates a refusal-first pattern for AI phone-agent
integrations:

1. Build a fictional delivery-exception planning payload.
2. Pass it to an in-process fake MCP server without network access.
3. Sanitize the synthetic response before returning it to the caller.
4. Reduce capability-shaped values to length-only fingerprints.
5. Omit the dial path entirely: no `run_call` function is shipped.

The public bundle contains only an offline demo and a validation command.
The live integration remains a documentation stub.

## Why Delivery Exceptions

Delivery exceptions often require coordination, but a planning tool should
not silently become a dialing tool. ParcelBridge treats refusal as a normal,
auditable outcome. It demonstrates how an integration can prepare a safe
planning payload while keeping call execution outside the reference app.

## Demo Status

The submitted demo is offline and synthetic.

- `python -m parcelbridge.cli demo --offline` exits successfully.
- `python -m parcelbridge.cli validate` exits successfully.
- `pytest tests/` passes **48 tests**.
- Network access is zero.
- OAuth cache reads are zero.
- Real calls placed are zero.
- `run_call` is absent.

A synthetic `READY` result is not presented as a live provider result.

## Architecture

```text
fictional scenario
    -> business payload builder
    -> inline fake MCP server
    -> fail-closed response sanitizer
    -> sanitized offline result
```

The package includes:

- `parcelbridge/payload.py` for validated business payloads.
- `parcelbridge/fake_mcp.py` for the in-process synthetic MCP response.
- `parcelbridge/sanitization.py` for fail-closed response reduction.
- `parcelbridge/workflow.py` for offline orchestration.
- `parcelbridge/live_stub.py` for explicit live-mode refusal.
- `bridge/calle_inprocess_bridge.mjs` as integration-pattern documentation,
  not vendored runtime code.

The dial path is absent by design.

## Installation

```bash
git clone <your-fork-url>
cd awesome-phone-call-agents/apps/python/parcelbridge
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
pip install -e '.[dev]'
```

The runtime package has no external dependencies. `pytest` is an optional
development dependency.

## Offline Demo

```bash
python -m parcelbridge.cli demo --offline
```

Optional arguments include a fictional scenario, language, region, notes, and
JSON output. User-supplied values pass through a deny-list policy before the
workflow runs.

The first line of output identifies the run as an offline synthetic demo.

## Expected Output

A normal run includes messages equivalent to:

```text
OFFLINE SYNTHETIC DEMO
mode=offline
inline fake MCP returned a synthetic READY response
capability values discarded; length fingerprints retained
run_call is not implemented
result=PASS_WITH_LIMITATION
```

The example does not expose capability values, credentials, phone data, or a
raw provider response.

## Credential Handling

The public reference app does not accept or read:

- real recipient phone data;
- OAuth credentials;
- live endpoint configuration;
- plan, confirmation, or run capability values.

It does not read a user credential cache and does not place sensitive values
in process arguments, environment variables, or disk argument files.

## Side Effects

The offline demo has no external side effects:

- no network request;
- no phone call;
- no subprocess invocation;
- no credential read;
- no persistent recipient record;
- no raw response persistence;
- no capability-value persistence;
- no file written to the user's home directory.

These boundaries are covered by the defensive test suite.

## Authorization Model

The public bundle documents a single-use, plan-only authorization model, but
it does not create or consume a live authorization. The offline fake response
is synthetic and cannot be used to execute a call.

The package exports no `run_call`, `get_call_run`, `track_ui_events`, `dial`,
or `place_call` function. There is no automatic retry path and no recurring
job.

## Privacy Boundaries

The privacy policy is implemented in `parcelbridge/policy.py` and documented
in `docs/SECURITY.md`.

Key boundaries:

- fictional demo data only;
- no persistent phone data;
- no credential loading;
- no live endpoint;
- capability-shaped values reduced before caller access;
- unrecognized or secret-shaped response values fail closed;
- no raw response written to disk.

## Dry-Run and Fake-Server Behavior

Run the self-audit without external side effects:

```bash
python -m parcelbridge.cli validate
```

The validation report checks policy configuration, fake MCP mode, default demo
execution, and absence of dial-path names. It exits non-zero when an invariant
fails.

The fake MCP server is in-process and deterministic. It exists only to test
the offline request, sanitization, and refusal surfaces.

## Live Verification

Live mode is opt-in and **not validated in this submission**.

The reference bundle does not execute the official live client, read real
credentials, contact a provider endpoint, or place calls. The Node bridge file
is a documentation stub showing where a separately authorized integration
could be connected.

A future live validation would require a new explicit authorization cycle,
real credential handling, endpoint-provenance evidence, and a separate review.
Call execution would remain outside this reference app.

## Cancellation and Rollback

There is nothing persistent to cancel in the offline demo:

- no scheduler;
- no background service;
- no retry queue;
- no recurring job;
- no live authorization;
- no call execution;
- no external resource creation.

Stopping the command ends the demo. The package does not create a replayable
capability.

## Testing

```bash
pytest tests/
python -m parcelbridge.cli validate
python -m parcelbridge.cli demo --offline
```

The suite contains **48 tests**:

- 30 functional offline tests;
- 18 defensive and self-audit tests.

The tests use sandboxed home, configuration, cache, and temporary directories.
They verify zero network access, zero OAuth reads, absence of phone data in
arguments, environment, and disk, no raw-response persistence, no capability
persistence, no dial path, fictional examples, bundle privacy, disclosure
completeness, and successful validation.

## Known Limitations

- Only the offline synthetic demo is implemented.
- The package does not vendor or execute the live CALL-E SDK.
- Provider-generated plan text is not available or verified.
- Business requirements are not provider-verified.
- Capability fingerprints are length-only and are not identifiers.
- The bundle is a reference app, not a production service.

## License

ParcelBridge is released under the MIT License. See `LICENSE`.

Copyright (c) 2026 ParcelBridge Contributors.
