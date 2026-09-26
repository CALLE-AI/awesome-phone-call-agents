# Architecture — ParcelBridge reference app

> **Disclosure.** This document describes the
> sanitized, self-contained reference app shipped at
> `apps/python/parcelbridge/`. The originating prototype
> runs the same shape against a local synthetic MCP
> interceptor in offline mode and exercises the official
> client SDK code path. The reference app demonstrates
> the **data shape** and the **refusal boundaries**; it
> does not vendor the SDK or any live configuration.

## 1. Component overview

The reference app is composed of four small modules:

| Module | Role | Default mode | Live-mode posture |
|---|---|---|---|
| `parcelbridge.payload` | Builds a frozen business payload from primitive inputs | n/a | n/a |
| `parcelbridge.offline` | Returns a sanitized synthetic plan_call response | **default** | n/a |
| `parcelbridge.live_stub` | Prints an explicit refusal message and exits | n/a | **opt-in stub** |
| `parcelbridge.sanitizer` | Walks any plan_call response and redacts secrets / surfaces length-only fingerprints | used by `offline` | not used by `live_stub` (no response is produced) |

The CLI (`parcelbridge.cli`) wires the four modules into a
single binary entry point.

## 2. Data flow

```
                ┌────────────────────────────┐
   CLI args ──▶ │  parcelbridge.payload      │
                │  (build_business_payload)  │
                └─────────────┬──────────────┘
                              │  BusinessPayload
                              ▼
                ┌────────────────────────────┐
                │  parcelbridge.offline      │
                │  (run_offline_plan_call)   │
                │                            │
                │  synthetic MCP interceptor │
                │  returns canned response   │
                └─────────────┬──────────────┘
                              │  raw response (in-memory)
                              ▼
                ┌────────────────────────────┐
                │  parcelbridge.sanitizer    │
                │  (sanitize_plan_response)  │
                │                            │
                │  - redacts capability keys │
                │  - surfaces safe enum keys │
                │  - fail-closes on secrets  │
                └─────────────┬──────────────┘
                              │  SanitizedResponse
                              ▼
                ┌────────────────────────────┐
                │  CLI stdout                │
                │  (or programmatic return)  │
                └────────────────────────────┘
```

The live-mode path is **not on this diagram** because there
is no live-mode path. Calling `run_live_stub_plan_call()`
short-circuits to a refusal message and exits.

## 3. Refusal boundaries

| Boundary | Enforcement point | What it refuses |
|---|---|---|
| Phone-shaped values in payload | `parcelbridge.payload._validate_text` | Any text field containing a phone / tel / e164 / card / cvv / iban / ssn / password / secret / bearer / oauth / token= / address-change substring |
| Unknown business scenario | `parcelbridge.payload.build_business_payload` | Any scenario name not in `SCENARIOS` |
| Secret-shaped response values | `parcelbridge.sanitizer._is_secret_like` | Any response value containing `bearer `, `bearer\t`, `oauth`, `ey` (JWT), `akia` (AWS), or `-----begin` |
| Live mode | `parcelbridge.cli.main` + `parcelbridge.live_stub.run_live_stub_plan_call` | Any `--live-stub` invocation; the stub never imports the SDK or contacts a network |
| Dial path | the **absence** of a `run_call` function | The reference app does not ship a dial code path; there is no `--run-call` flag, no `run_call()` function, and no transport glue |

## 4. Capability values: discard discipline

The synthetic MCP interceptor returns a canned response in
which **no real capability values are present**. The
sanitizer enforces this defensively:

* If a future live integration accidentally surfaced a
  real `confirm_token`, the sanitizer's
  `_REDACTED_CAPABILITY_FIELDS` set would replace it
  with a length-only fingerprint.
* If a future live integration surfaced a secret-shaped
  value (e.g. `Bearer ...`), the sanitizer's
  `_SECRET_LIKE_SUBSTRINGS` check would raise
  `SanitizationViolationError` rather than leak the value.

The sanitizer is the public counterpart of the
`sanitize_plan_response` function in the originating
prototype. The prototype's version walks deeper envelope
shapes (e.g. `result.structuredContent`); the public
reference app walks only the top-level + `capability_values`
because the reference app does not vendor the SDK envelope.

## 5. Why the live-mode stub is a stub, not a partial implementation

A "live-mode" that wires a partial dial path would be a
defensive liability: it would look runnable but would
expose footguns (e.g. accidental reads of OAuth caches,
accidental phone-number echoes, accidental command-line
exposure of secrets).

The reference app chooses to ship **no dial path at all**.
The CLI's `--live-stub` flag exists to make this omission
explicit and to give reviewers a single sentence to point
at when they want to verify the omission.

## 6. Provenance and separation

The public bundle is a **subset** of the originating
prototype. Specifically:

* **Included:** payload shape, sanitizer shape, offline
  interceptor shape, refusal message, CLI wiring, tests,
  pyproject metadata, README, ARCHITECTURE, SECURITY,
  DISCLOSURE.
* **Excluded:** recipient file handling (sandbox file,
  mode 0600, parent mode 0700, owner-pinned — these are
  documented in `SECURITY.md` but the file discipline
  belongs to the originating prototype, not the public
  bundle), authorization state machine (the
  `single-use plan-only` discipline is documented but the
  state machine itself is private to the integrator), real
  OAuth cache handling, audit reports, runtime artifacts.

The originating prototype's `state/project-state.json`
records nine negative-satisfaction gates that prove the
public bundle is a sanitized extraction:

```
p1i_no_phone_numbers_published = true
p1i_no_oauth_tokens_published = true
p1i_no_urls_published = true
p1i_no_pids_published = true
p1i_no_recipient_content_published = true
p1i_no_real_call_claimed = true
p1i_no_live_endpoint_claimed = true
p1i_no_production_ready_claimed = true
p1i_secrets_in_git_diff = false
```

The reference app cannot violate these gates by accident
because it contains nothing that would satisfy them, by
design.