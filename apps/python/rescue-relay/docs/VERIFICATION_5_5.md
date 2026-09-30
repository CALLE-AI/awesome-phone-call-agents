# Verification — Rescue Relay 5.5.0

Verified 10 September 2026. Raw outputs and current intake screenshots are in `verification/v55/`. The original archive was not modified.

| Check | Result |
| --- | --- |
| Python application, API, migration, semantic-contract and mocked-provider tests | 560 passed, 1 skipped |
| Dependency-free JavaScript state projection tests | 67 passed |
| New intake selection browser scenarios | 7 passed |
| Full release/browser journey and responsive/player assertions | 58 passed |
| Python compilation and JavaScript syntax | Passed |

The skipped Python test exercises the real OpenAI SDK against a local HTTP stub. The SDK was not installed in this environment and dependency installation could not reach the package index. It remains an existing runtime requirement and the test is runnable after installing `requirements-dev.txt`. Other model tests inject deterministic model-output fixtures; they do not call an external model or measure a model's real-world language quality.

## New coverage

Semantic review accepts grounded, non-imperative success criteria and custom welfare outcomes without an action-word whitelist. Tests distinguish application scope from matching the report, reject restaurant errands and unrelated goals, preserve conditions, reject unsupported quotes/species, keep a clear goal while location is missing, and expose missing responder capabilities without changing the goal. Missing semantic output is visibly rejected/fallback-labelled rather than passed off as model understanding. Downstream fallback may not invent a clinic trip for a custom goal.

CALL-E tests use `httpx.MockTransport`: durable save before any HTTP; immediate ID save; lost-create-response recovery with byte-identical request/key; GET-only known-ID recovery; safe HTTP diagnostics; immutable request snapshots; additive migration/restart retention; stale/duplicate recovery rejection; revoked-consent replay blocking; and callback recovery under the original approved price ceiling. All requests are intercepted locally. No CALL-E credential, real phone call, live provider result or real recipient is used.

The new browser scenarios run the actual HTML, CSS and JavaScript with a temporary mock-mode FastAPI/SQLite server. Selecting a goal makes no write; typing or form edits invalidate selection; Send and Confirm goal do not change based on an inferred choice; confirming saves without starting a run; Find help is separate; and goal controls reflow at 320, 390, 640 and 1440 pixels. The built-in engine badge is visible. The full journey additionally exercises comparison, approval, progress, closure, keyboard/dialog behaviour, responsive views and the retained tutorial player. Counts are assertions/scenarios, not independent real-world rescues.

This environment blocks native Chromium navigation to localhost. Browser runs used the project's explicit `BROWSER_HTTP_BRIDGE=1` harness, forwarding to the real isolated local API while loading actual assets. This does **not** verify production-origin storage, browser navigation security, CSP or native reload. Draft serialization/restoration was exercised with a storage fixture in bridge mode. No browser policy was disabled. No JavaScript page errors were observed in the passing suites.

## Reproduce

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python -m pytest -q
node --test tests/rescue_flow_ui.test.cjs
python scripts/test_v55_browser.py
python scripts/test_release_browser.py
```

Default browser runs navigate localhost normally and exercise native reload. In an appropriately restricted test environment, explicitly set `BROWSER_HTTP_BRIDGE=1`; the resulting JSON states that limitation. Runtime API and fixture tests need no external provider.

## Files and historical evidence

The complete kit has a regenerated SHA-256 release manifest. It excludes private environment/database files, Python caches and transient artifacts. Database upgrades are additive and preserve previous rows; original historical CALL-E bodies that were not recorded cannot be reconstructed by this patch.

The source archive's 5.4.0 videos, captions and gallery are retained and labelled as historical. They were not re-recorded or presented as current 5.5.0 footage. The old verification report remains historical; these are the current results. Legacy test fixtures were updated for the new version/semantic contract and required pre-network persistence callback, not removed to hide failures.
