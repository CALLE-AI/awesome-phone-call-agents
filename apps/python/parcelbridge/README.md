# ParcelBridge

> **Disclosure.** This is a sanitized, self-contained
> reference app. The default demo is an **offline synthetic
> MCP validation**. It exercises the official CALL-E client
> code path *shape* but does **not** claim a live CALL-E
> endpoint call, a real phone call, provider-verified
> business semantics, or production readiness. See
> `docs/DISCLOSURE.md` for the full allowed-claim contract.

---

## What It Does

ParcelBridge is a refusal-first reference app for AI
phone-call-agent integration. It demonstrates how to:

1. Materialise a synthetic MCP response in-process without
   contacting any network endpoint.
2. Reduce capability values (`confirm_token`, `plan_id`, …)
   to length-only fingerprints before any caller can read
   them.
3. Refuse the live-mode dial path explicitly: a `--live-stub`
   flag prints a refusal and exits non-zero. The live mode
   is a documentation stub, not a partial implementation.
4. Enforce a fail-closed sanitizer that raises on any
   secret-shaped value (`Bearer …`, JWT prefix, AWS key
   prefix, PEM header).
5. Omit the dial path entirely: there is no `run_call`
   function, no `--run-call` CLI flag, no subprocess glue
   to the upstream SDK.

The reference app is small enough to read in one sitting
(about 700 lines of Python across 8 modules) and the test
suite runs in under a second.

---

## Why Delivery Exceptions

Most phone-call-agent references start with "how to dial".
That framing has two failure modes:

* **Silent side-effects.** A caller that asks "what is
  the dial path?" finds one. The caller then dials without
  realising the dial is a real-world action that cannot be
  undone.
* **No clear refusal surface.** If the dial is hard-wired
  into the reference app, the integrator cannot easily
  express "I am not allowed to dial in this environment".

Delivery exceptions (gate-code failure, recipient
unavailable, building access failed, unsupported address
change) are exactly the cases where the right answer is
**not to dial**. ParcelBridge treats that case as the
default rather than as an error path.

---

## Demo Status

> **The default demo is an offline synthetic MCP
> validation. It exercises the official CALL-E client code
> path but does not claim a live CALL-E endpoint call or a
> real phone call.**

The demo is the **only** mode this bundle ships. The live
mode is documented but not implemented; the upstream SDK is
not vendored. Any reviewer who runs the demo can confirm:

* `python -m parcelbridge.cli demo --offline` exits zero.
* `python -m parcelbridge.cli validate` exits zero.
* `pytest tests/` exits zero with **45** tests passing.
* No network connection is made.
* No phone number, OAuth token, plan ID, confirm token, or
  run ID appears in argv, environment, or disk artifacts.

---

## Architecture

The package is organised as:

```
parcelbridge/
├── __init__.py            Public surface; re-exports.
├── __main__.py            Entry point for ``python -m parcelbridge``.
├── cli.py                 Argparse CLI with ``demo`` and ``validate`` subcommands.
├── exceptions.py          Domain errors.
├── payload.py             Business-payload builder with denylist validation.
├── policy.py              Privacy / disclosure policy constants + self-audit.
├── sanitization.py        Canonical response sanitizer.
├── sanitizer.py           Backwards-compat re-export shim.
├── fake_mcp.py            Inline fake MCP server (canonical).
├── offline.py             Backwards-compat re-export shim.
├── workflow.py            Top-level orchestration: ``run_offline_demo``,
│                          ``validate_payload``, ``validate_workflow``.
├── live_stub.py           Live-mode refusal stub.
└── bridge/
    ├── __init__.py        Python-side re-exports for the Node bridge.
    └── calle_inprocess_bridge.mjs
                           Integration-pattern documentation (NOT vendored
                           runtime code).
```

The data flow is:

```
build_business_payload  ──►  run_fake_mcp_plan_call  ──►  sanitize_plan_response  ──►  caller
        │                            │                              │
        │                            │                              └─► SanitizedResponse
        │                            └─► InlineFakeMcpServer.call_plan
        └─► BusinessPayload
```

The `run_call` step is **absent by design**. See
`docs/ARCHITECTURE.md` for the full data-flow diagram.

---

## Installation

```bash
git clone <fork-url>
cd apps/python/parcelbridge
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

No external runtime dependencies. The test runner is the
only optional dependency and is documented under
`[project.optional-dependencies]` in `pyproject.toml`.

---

## Offline Demo

Run the default offline synthetic demo:

```bash
python -m parcelbridge.cli demo --offline
```

The CLI prints an `OFFLINE SYNTHETIC DEMO` banner first so
the provenance is never ambiguous in CI logs, then exercises
the inline fake MCP server and surfaces the sanitized
response.

The demo accepts the following optional flags:

* `--scenario {gate-code-failure, recipient-unavailable, neighbor-delegation, building-access-failed, unsupported-address-change}` (default: `gate-code-failure`).
* `--language <bcp47>` (default: `en-US`).
* `--region <iso3166-1-alpha-2>` (default: `US`).
* `--notes <free text>` (subject to the banned-substring policy).
* `--json` (emit the sanitized response as JSON on stdout).

---

## Expected Output

The default demo prints:

```
OFFLINE SYNTHETIC DEMO
----------------------
This is an OFFLINE synthetic MCP validation. The default
demo exercises the official CALL-E client code path shape
but does NOT claim a live CALL-E endpoint call, a real
phone call, provider-verified business semantics, or
production readiness. See bundle docs/DISCLOSURE.md for
the full allowed-claim contract.

[parcelbridge] mode=offline scenario=gate-code-failure
[parcelbridge] inline fake MCP server returned a READY response
[parcelbridge] confirm_token_length=37 (synthetic fingerprint)
[parcelbridge] plan_id_length=37 (synthetic fingerprint)
[parcelbridge] capability values DISCARDED; only length fingerprints retained
[parcelbridge] run_call is not implemented; nothing to dial
[parcelbridge] result=PASS_WITH_LIMITATION
```

With `--json`, an additional `--- JSON envelope ---` section
prints the full sanitized response.

---

## Credential Handling

The reference bundle **never** accepts:

* a real phone number,
* an OAuth bearer token,
* a `plan_id`, `confirm_token`, or `run_id`,
* a live endpoint URL, hostname, or port.

The `--notes` field, the `--region` field, and the
`--language` field are all subject to the banned-substring
policy in `parcelbridge/policy.py`. Any value containing
`phone`, `tel:`, `e164`, `card`, `cvv`, `iban`, `ssn`,
`password`, `secret`, `bearer `, `oauth`, `token=`, or
`address-change` is rejected at the CLI parser.

The `--live-stub` mode (where present in earlier layouts)
was removed in favour of the default-mode-is-offline
invariant. The live-mode refusal is now exercised by
importing `parcelbridge.live_stub.run_live_stub_plan_call`
directly, not through a CLI flag.

---

## Side Effects

> **offline demo side effects = none**

* No network access is made.
* No persistent phone number is stored.
* No capability persistence: capability values are reduced
  to length-only fingerprints and the originals are not
  written to disk.
* No OAuth cache is read.
* No subprocess is spawned.
* No file in the user's HOME is written.

The defensive test suite
(`tests/test_defensive_invariants.py`) asserts each
invariant.

---

## Authorization Model

The reference bundle implements a **single-use,
plan-only** authorization model:

* The bundle ships no `plan_call` against a live endpoint.
  All `plan_call` invocations are against the inline fake
  MCP server.
* The bundle ships no `run_call`. The function is absent
  from the public surface.
* The bundle ships no `get_call_run` or `track_ui_events`.
* Authorization cannot be replayed because there is no
  authorization to begin with: the bundle does not call
  `plan_call` against a live endpoint, so no plan is
  created, no `confirm_token` is issued, and no
  `run_id` exists.

This is the inverse of the upstream SDK's authorization
flow: the upstream SDK issues a `confirm_token` after a
live `plan_call`; ParcelBridge issues no token because it
never calls a live endpoint.

---

## Privacy Boundaries

The package is governed by `parcelbridge/policy.py`. The
policy module exposes three constant tuples:

* `BANNED_PAYLOAD_SUBSTRINGS` — rejected by the payload
  builder in user-supplied fields.
* `BANNED_RESPONSE_SUBSTRINGS` — rejected by the sanitizer
  as fail-closed secrets.
* `SIDE_EFFECT_INVENTORY` — the canonical list of side
  effects the offline demo must NOT trigger. Asserted by
  the defensive test suite.

The privacy boundaries are also documented in
`docs/SECURITY.md`.

---

## Dry-Run and Fake-Server Behavior

The `--validate` subcommand runs the workflow's self-audit
without performing any side effect:

```bash
python -m parcelbridge.cli validate
```

The audit returns a JSON report with three top-level keys:

* `policy` — the policy module's self-audit (denylist
  well-formedness, side-effect inventory coverage).
* `fake_mcp_bridge_mode` — whether the inline fake MCP
  server reports the expected bridge mode label.
* `default_demo_succeeded` — whether the default scenario
  can be exercised without raising.

The audit exits zero when every check passes.

---

## Live Verification

> **Live mode is opt-in and not validated in this
> submission.**

The live mode is documented in `parcelbridge/live_stub.py`
and `parcelbridge/bridge/calle_inprocess_bridge.mjs`, but
**not implemented** in this reference bundle. To exercise
live mode, an integrator must:

1. Install the upstream SDK separately.
2. Replace the inline fake MCP server with the SDK's MCP
   envelope.
3. Provide explicit CALL-E credentials via the integrator's
   own secret-management system — never via argv, never via
   environment variables, never via the user's HOME.
4. Confirm the dial path is not exercised by the reference
   demo (`run_call` remains absent from the reference).

The reference bundle does **not** validate that the live
mode works. Any claim that "live mode is verified" is
forbidden by `docs/DISCLOSURE.md`.

---

## Cancellation and Rollback

The reference bundle ships with **no** recurring jobs,
**no** automatic retries, and **no** persistent state
that would need to be cancelled or rolled back:

* **No recurring job.** The package contains no
  `cron`-style entry point, no scheduler, no
  background-thread entry point.
* **No automatic retry.** The package contains no retry
  loop, no exponential backoff, no persistent queue.
* **Consumed authorization cannot be replayed.** The
  reference bundle does not consume any authorization
  against a live endpoint. There is no `confirm_token`,
  `plan_id`, or `run_id` to replay.
* **run_call is disabled.** The function is absent from
  the public surface. The defensive test suite asserts
  that `run_call`, `get_call_run`, `track_ui_events`,
  `dial`, and `place_call` are not exported.

---

## Testing

Run the hermetic test suite:

```bash
pytest tests/
```

The suite is split into two modules:

* `tests/test_offline_only.py` — **30** tests covering
  the payload builder, the offline interceptor, the
  live-stub refusal, the sanitizer, and the CLI.
* `tests/test_defensive_invariants.py` — **15** tests
  covering the defensive surface mandated by the
  submission spec: network access, OAuth cache reads,
  argv / environment / disk phone detection, raw-response
  persistence, capability-value persistence, `run_call`
  absence, README completeness, and bundle privacy.

All tests are hermetic: they use a sandboxed `HOME` /
`XDG` / `TMPDIR`, run without network access, and never
read the OAuth cache.

---

## Known Limitations

* The reference bundle implements only the offline
  synthetic demo. The live mode is documented but not
  implemented.
* The reference bundle does not vendor the upstream SDK.
  An integrator who wants live wiring must fork the
  bundle and replace the inline fake MCP server with
  the SDK's MCP envelope.
* The `bridge/calle_inprocess_bridge.mjs` file is a
  documentation stub, not vendored runtime code. It
  shows where a real Node bridge would be inserted,
  but it does not import the upstream SDK.
* The capability value fingerprints are **length-only**.
  Two responses with capability values of identical
  length are indistinguishable from the caller's
  perspective. This is by design: the caller never
  needs to compare capability values across responses.

---

## License

The license is currently
`LICENSE_PLACEHOLDER_PENDING_HUMAN_DECISION`. The human
submitter must replace this placeholder with a permissive
OSS license (MIT, Apache-2.0, BSD-3-Clause, or compatible)
before opening the upstream PR. The `pyproject.toml`
classifiers list the upstream license as `MIT License`
(placeholder) and the `[project].license.text` field
records the placeholder string.

The `authors` field in `pyproject.toml` is also a
placeholder (`["ParcelBridge Submitter Placeholder"]`)
and must be filled in by the human submitter at PR open
time.