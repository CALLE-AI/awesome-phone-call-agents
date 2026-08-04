# Disclosure — allowed-claim contract

> **This disclosure is the contract.** Every README,
> doc, comment, and test in this bundle must obey the
> allowed-claim list below. Submitting a PR that
> contradicts this contract is grounds for review
> rejection.

## 1. Allowed claims

The reference app **may** say any of the following,
including exact phrasing if desired:

1. ParcelBridge is a **safety-first reference app** for
   AI phone-agent integration.
2. The reference app demonstrates the **refusal-first
   pattern** — the dial path is omitted by design.
3. The default mode is **offline-fake / no-call**.
4. The **synthetic MCP interceptor** returns a canned
   `plan_call` response without contacting any network.
5. Capability values are **discarded** after length
   extraction and never reach the caller.
6. The live-mode entry point is a **documentation
   stub** that prints an explicit refusal message.
7. The package does **not ship** phone numbers, OAuth
   tokens, plan IDs, confirm tokens, run IDs, live
   endpoint URLs, hostnames, ports, PIDs, systemd
   units, real account info, or recipient file content.
8. The test suite is **offline-only** and hermetic.
9. The originating prototype exercised the **official
   client code path** against a local synthetic
   interceptor; this reference app demonstrates the
   data shape, not the SDK glue.
10. The reference app is **not production-ready**; it
    is a developer-facing reference app.

## 2. Forbidden claims

The reference app **must not** say any of the
following, including exact phrasing if desired:

1. ~~"ParcelBridge made a real phone call."~~
2. ~~"ParcelBridge validated a real `plan_call`
   response."~~
3. ~~"ParcelBridge is production-ready."~~
4. ~~"The CALL-E service confirmed the plan."~~
5. ~~"ParcelBridge reached a real CALL-E endpoint."~~
6. ~~"The recipient has been contacted."~~
7. ~~"We have a live plan that can be executed."~~
8. ~~"The next step is to dial the recipient."~~
9. ~~"The capability values are ready to be used."~~
10. ~~"Our authorization is reusable."~~
11. ~~"Re-running the demo will dial the recipient."~~
12. ~~"The CALL-E endpoint is reachable from this
    repo."~~
13. ~~"ParcelBridge is a deployment."~~
14. ~~"ParcelBridge is a service."~~
15. ~~"This README contains a phone number,
    token, or URL."~~

## 3. Disambiguation rules

To prevent the Forbidden-claim phrasing from being read
between the lines of the Allowed claims, the following
disambiguation applies to every claim-rewriting:

| Allowed phrasing | Forbidden rewrite | Why this distinction matters |
|---|---|---|
| "synthetic MCP interceptor" | "our CALL-E instance" | The interceptor is a test fixture inside the package; "our instance" implies a real provider. |
| "synthetic READY response" | "live READY plan" | "synthetic" names the response origin; "live" implies a real provider. |
| "documentation stub" | "partial implementation" | A stub is a refusal; a partial implementation is a footgun. |
| "length-only fingerprint" | "real token" | A fingerprint is a length; a real token would surface the value. |
| "offline-fake default mode" | "no-call mode" | "offline-fake" names the response origin; "no-call" could be misread as "we never tested anything." |
| "not implemented at all" | "feature-flagged off" | "not implemented" is structural; "feature-flagged off" is procedural and could be flipped. |
| "refusal-first pattern" | "safety-first pattern" | "refusal-first" names the engineering contribution; "safety-first" is a vibe. |

## 4. Sanitization rules for PR text

PR title, PR body, comments, and review replies must
obey:

* **No phone numbers** in any form, including example
  ones (`+1-555-...`).
* **No plan_id, confirm_token, run_id** in any
  committed artifact.
* **No OAuth, bearer, or refresh_token** values.
* **No URL, hostname, IP, port, or socket path** — even
  loopback sentinels. Use descriptive placeholders
  (`<upstream-sdk-url>`, `<synthetic-loopback>`).
* **No PID, parent process name, or runtime.** The
  reference app is a library, not a service.
* **No recipient content** in any form. The recipient is
  a sandbox-mode file in the originating prototype; its
  contents must never be authored into this bundle.
* **No live CALL-E endpoint name.** Refer to it as
  "the official AI phone-agent SDK" or "the upstream
  `plan_call` API surface."
* **No claim of "production-ready."** The package is
  `Development Status :: 3 - Alpha`.

## 5. Failure modes

If any text in this bundle contains a Forbidden claim
or a sanitization violation:

1. The PR is sent back for revision.
2. The contributor is asked to revise against this
   matrix.
3. The merge is blocked until the violation is removed.

The originating prototype's broader claims matrix (in
`docs/submission/claims-matrix.md` of the private
prototype) is a superset of this disclosure; this
document is the public-bundle subset.