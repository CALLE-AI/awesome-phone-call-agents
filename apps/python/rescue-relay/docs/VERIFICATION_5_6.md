# Verification — Rescue Relay 5.6.0

Verified 11 September 2026. The uploaded original archives remain unchanged. Raw test outputs, UI screenshots and browser JSON are in `verification/v56/`.

| Check | Result |
| --- | --- |
| Python application, API, migration, conditional-contract, authentication, diagnostic, endpoint-security and mocked-provider tests | **673 passed** |
| Dependency-free JavaScript state projection tests | **77 passed** |
| Conditional goal / approval / assessment / branch UI journey | **10 passed** |
| Existing semantic intake selection UI journey | **7 passed** |
| CALL-E unconfirmed-create / pending-result UI fixtures | **6 passed** |
| Full release journey, responsiveness and retained player assertions | **58 passed** |
| Current v5.6 product-demonstration journey | **24 passed; 19 captioned scenes; 174.8 seconds** |
| Python compilation and JavaScript syntax | Passed |

Browser counts are checks/scenarios, not independent live rescues. The 6 provider UI checks explicitly supply local provider-error fixtures to the actual renderer; they do not exercise live CALL-E. HTTP and recovery behavior is separately tested with local transport fixtures and an isolated API/database.

## What the new tests establish

**Conditional goals.** The exact supplied IF/ELSE correction and original assessment-and-feeding goal both produce a selectable whole goal without the obsolete stage menu. Fixtures distinguish unconditional feeding from ELSE-only feeding, preserve conditions in paraphrases, retire saved obsolete questions, reject missing branches and out-of-scope errands, keep real missing-location questions, and prevent a suggested button from silently narrowing the goal. A grounded model-output fixture is not an external model inference.

**Planning and execution.** Typed, quote-grounded decisions and gates reject dangling references, cycles, contradictory dependencies, omitted feeding, dropped ELSE and flattened transport. Offer/callback fixtures require the actual contingent start rules and original price limit. YES and NO are exercised through complete application workflows. Pending is never a NO. Recording a reporter-acknowledged result is idempotent for the same value, rejects contradictory/stale/unsupported submissions, initiates no call and invents no completed work. Unused tasks remain unnecessary rather than being marked performed. Applicable tasks and final human outcome confirmation remain necessary for closure.

**CALL-E transport.** Every unconfirmed create outcome performs one POST and then halts for reconciliation; `call_not_ready` is never an automatic replay trigger. A known-ID `call_not_ready` is polled with GET only. Tests cover the overall deadline, numeric/date Retry-After, insufficient remaining polling budget, cancellation, missing IDs, and non-readiness 422 errors. IDs mentioned only in arbitrary error details are never promoted to Calls API IDs. Sanitized provider `message` and `details.questions` guidance is preserved without exposing credentials, email addresses or phone numbers.

**Model transport.** Remote LLM traffic requires an exact origin match in the explicit HTTPS allowlist and a base path ending in `/v1`; the official OpenAI origin is pre-approved. Insecure origins, hostname lookalikes, URL credentials, queries, fragments and traversal segments are rejected before client creation. Redirect following is disabled. Loopback `/v1` development is allowed but never receives the environment API key. All model calls remain backend-only.

**Public authentication.** Production mode fails closed unless both HTTP Basic environment credentials are configured. The root page, static assets, read APIs, run/transcript data and mutation endpoints all require authentication. Invalid schemes, malformed Base64 and wrong credentials receive the same bounded 401 response. `/health` is the only public route so Render can verify readiness; it exposes only status and version.

## CALL-E contract audit

The transport was compared on September 10, 2026 with CALL-E's live Calls guide, Errors guide and Developer API reference version 0.7.0. The implementation uses the documented bearer authorization, `POST /v1/calls`, explicit E.164 recipients, strict supported `result_schema`, stable `Idempotency-Key`, top-level CallTask ID persistence and `GET /v1/calls/{call_id}` polling. It recognizes the five documented top-level states and reads task results separately from nested `recipients[].attempts[].transcript_turns`. It preserves task failure fields as diagnostics rather than treating them as a published enum.

**Persistence/privacy.** Existing request-before-POST and ID-before-GET invariants, original-request ledger, callback price limits, restart retention, stale recovery protection and consent checks continue passing. New tests retain private provider diagnostics in SQLite while excluding them from both inquiry and callback API output. Configured API keys/bearer credentials are redacted and private bodies are bounded. The diagnostic script is offline/read-only by default; optional provider checks are GET-only for saved IDs and events. It never sends a POST, creates a call or modifies the database.

**Interface.** Real controls accept the exact goal without saving or calling on selection. Approval displays both branches and price limits. Recording a NO enables feeding but not transport, with no call and no false progress. The provider fixtures show separate no-ID and known-ID messages/actions, display the actual saved key/ID, and prove that cancelling recovery sends no request. Controls and long identifiers reflow at small mobile widths.

## Explicit limits

The public product demonstration does not contain private call data, external model inference, a real recipient or a physical rescue. Its fictional test scenario demonstrates the application workflow; live CALL-E transport remains available through the separately configured local path. The old 5.5.0 error path discarded provider message/details, so missing historical diagnostics cannot be recovered retroactively.

The OpenAI SDK serialization test runs against a local HTTP stub; it sends no external inference request. Other semantic/coordinator tests inject deterministic outputs. Full semantic quality must be evaluated with the configured model.

Native Chromium navigation to localhost is restricted here. Browser suites used the explicit `BROWSER_HTTP_BRIDGE=1` harness with actual application assets and an isolated mock-mode server. This does **not** verify production-origin storage, CSP, native browser navigation security or native reload. The intake draft-restoration check uses a declared storage fixture in bridge mode. No browser policy was disabled. Passing runs reported no JavaScript page errors.

The generic conditional schema is bounded to four decisions/eight tasks. Its rule-based fallback is intentionally narrower than the model path. It is not a guarantee that arbitrary natural-language conditionals can be interpreted or executed. Recorded branch results are reports from the user about the assigned assessor, not independently verified measurements or model diagnoses. Recording an assessment does not place a new activation call.

## Reproduce

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python -m pytest -q
node --test tests/rescue_flow_ui.test.cjs
python scripts/test_v56_browser.py
python scripts/test_v56_provider_browser.py
python scripts/test_v55_browser.py
python scripts/test_release_browser.py
```

Default browser runs use actual localhost navigation. Use `BROWSER_HTTP_BRIDGE=1` only for a restricted test environment; the output JSON states this limitation. Provider-error UI tests label their data as fixtures; all backend tests intercept provider requests locally.

## Release contents

The release manifest records SHA-256 hashes for packaged files and the source archive. It excludes private `.env`/database files, Python caches, transient browser outputs and the manifest itself. Current verification artifacts are copied into this documentation folder.

The short product demonstration, its captions, chapter data, poster and primary gallery images were regenerated from v5.6. The longer tutorial and its supporting mobile/player screenshots remain labelled historical supplements. Earlier verification and upgrade documents remain historical. Old forced-stage tests were updated to test the new contingent behavior, while retaining tests for genuine missing details, explicit prohibitions, scope mismatches, payment/consent and uncertain calls.
