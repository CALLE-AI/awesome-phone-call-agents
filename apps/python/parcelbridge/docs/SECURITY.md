# Security & Privacy — ParcelBridge reference app

> **Disclosure.** This document describes the defensive
> discipline baked into the public reference app. The
> originating prototype's threat model includes sandbox
> recipient file handling, in-memory bridge transport, and
> single-use authorization. Those concerns are **not in
> the public bundle** because they are private to the
> integrator. This document explains what the public
> bundle does and does not defend against.

## 1. Threat model (public bundle)

The reference app defends against:

* **Accidental CLI misuse.** A reviewer who runs the CLI
  with a phone-shaped string, an OAuth-shaped string, or
  any forbidden substring is rejected by
  `parcelbridge.payload._validate_text`.
* **Accidental response surfacing.** A reviewer who wires
  the public bundle to a future live integration that
  accidentally returns a secret-shaped value is rejected
  by `parcelbridge.sanitizer._is_secret_like`.
* **Accidental live-mode invocation.** A reviewer who
  runs `--live-stub` is shown an explicit refusal message;
  the mode is not a partial implementation.
* **Capability value leak.** The sanitizer replaces
  capability-shaped values with length-only fingerprints
  before any caller can read them.

The reference app **does not** defend against:

* **Production deployment.** The package is
  `Development Status :: 3 - Alpha`; no production
  hardening is implied.
* **Root-level attacks.** A root user can read any file;
  the reference app's payload validation is not a defense
  against root.
* **Compromised SDK.** If a future integrator wires a
  compromised SDK, the reference app inherits the
  compromise. The reference app is a defensive shape, not
  a vendor audit.

## 2. Defensive disciplines

### 2.1 Payload discipline

`parcelbridge.payload.build_business_payload` rejects any
input containing:

```
phone, tel:, e164, card, cvv, iban, ssn,
password, secret, bearer , oauth, token=,
address-change
```

The list is small, explicit, and case-insensitive. The
intent is to make the contract auditable: a reviewer can
read the list and verify that the forbidden substrings are
the minimum necessary to reject obvious footguns.

### 2.2 Sanitizer fail-closed

`parcelbridge.sanitizer.sanitize_plan_response` walks the
response and:

* surfaces safe enum keys (`bridge_mode`, `scenario`,
  `ready_to_run`) verbatim,
* replaces any value whose key is in
  `_REDACTED_CAPABILITY_FIELDS` with a length-only
  fingerprint,
* walks `capability_values` sub-mapping and reduces every
  value to a length-only fingerprint,
* replaces any other field with an opaque length record
  (`{_opaque: True, length: N}`),
* raises `SanitizationViolationError` if any value
  contains a secret-shaped substring.

The sanitizer never leaks a value it does not recognise.
The hard-fail on secret-shaped values is the fail-closed
guarantee: a defensive integrator should treat the
response as untrusted rather than risk the sanitizer
missing a key the allow-list forgot.

### 2.3 Live-mode refusal

`parcelbridge.live_stub.run_live_stub_plan_call` does not
import the SDK, does not open a network socket, does not
read a credential file, and does not contain a partial
implementation of the dial path. It returns a refusal
message and exits.

The CLI maps `--live-stub` to a non-zero exit code (`2`)
so that automation (CI, smoke tests) can detect the
refusal without parsing the message text.

### 2.4 Absence of the dial path

The reference app does not ship:

* a `run_call()` function,
* a `--run-call` CLI flag,
* a subprocess glue to the upstream SDK,
* a `dial.py` / `start_call.py` / `make_call.py` file.

The dial path is omitted by design. A reviewer who greps
for `run_call` in the package source will find zero
matches; the absence is the contribution.

## 3. What the public bundle does not contain

The public bundle is a sanitized extraction. The
following are deliberately not vendored in:

* Phone numbers — the reference app validates text but
  never holds a phone number value. The originating
  prototype's recipient file (mode 0600, parent mode
  0700, owner-pinned) is a private artifact and is not
  shipped here.
* OAuth tokens — the reference app's sanitizer
  redacts token-shaped values but never holds an OAuth
  token. The originating prototype's OAuth cache is a
  private artifact and is not shipped here.
* Live endpoint URLs, hostnames, ports — the reference
  app's offline interceptor is in-memory only. The
  originating prototype's loopback sentinel URL is a
  private artifact and is not shipped here.
* Plan IDs, confirm tokens, run IDs — the reference
  app's synthetic interceptor carries a length-only
  fingerprint (`confirm_token_length = 37`) and never
  holds an actual token. The originating prototype's
  capability values are redacted before they reach the
  Python layer.
* PIDs, parent process names, systemd units — the
  reference app is a library; it has no daemon
  lifecycle.
* Real account information — the reference app's
  `pyproject.toml` authors field is a placeholder
  (`"ParcelBridge Submitter Placeholder"`); the
  maintainer is expected to fill in the real value at
  PR review time.

## 4. Test-time discipline

The test suite (`tests/test_offline_only.py`) is marked
`offline_only` and is hermetic:

* No subprocess is invoked with a phone number, OAuth
  token, or credential in its argv.
* No network is contacted.
* No file with secrets is read.
* The CLI subprocess is invoked with a stripped-down
  environment (`{"PATH": "/usr/bin:/bin", "PYTHONPATH":
  ...}`) so that no inherited environment variable can
  leak into the subprocess argv.

The tests verify:

* the payload builder rejects forbidden substrings,
* the offline interceptor's canary length is stable,
* the live-stub refuses (exit code, refusal message),
* the sanitizer fail-closes on secret-shaped values,
* the CLI never accepts a phone-shaped argument.

## 5. Residual risks

* **Sanitizer walks only top-level + capability_values.**
  A future live integration that nests plan text under
  `result.structuredContent` or `content[]` would need a
  `_opaque` walker extension. This is recorded as a
  future hardening item, not as a current defect.
* **Forbidden-substring list is denylist-based.** A
  reviewer who invents a new secret shape (e.g.
  `aws_session_token=...`) would need to add it to the
  list. The list is short and explicit so that adding a
  new entry is a single PR.
* **Live-mode stub is documentation, not enforcement.**
  The reference app cannot prevent an integrator from
  forking the package and adding a real dial path. The
  refusal message is the boundary; the integrators'
  discipline is the enforcement.

## 6. Conclusion

The reference app demonstrates a **safety discipline**
for AI phone-agent integration at the package level. The
discipline is:

* explicit payload validation against a denylist of
  sensitive substrings,
* explicit response redaction with fail-closed
  secret-shape detection,
* explicit refusal of the live-mode path,
* explicit absence of the dial path.

The discipline is documented, verifiable, and
falsifiable. A reviewer can re-run the offline demo, the
unit tests, and the refusal-message walk in under a
minute.