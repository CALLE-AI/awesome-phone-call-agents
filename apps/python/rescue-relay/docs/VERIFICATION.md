> Historical 5.4.0 results. Current patch verification is in [VERIFICATION_5_5.md](VERIFICATION_5_5.md).

# Release verification — 5.4.0

Verified 10 September 2026 against the supplied project archive and the polished release.

## Results

| Check | Result |
| --- | --- |
| Python application tests (`pytest -q`) | **517 passed, 1 skipped** |
| Pure JavaScript UI-state tests | **59 passed** |
| Full release browser suite | **57 passed** |
| Conditional-offer / approval browser regression | **11 passed** |
| Incomplete-callback recovery browser regression | **15 passed** |
| Real bundled-video playback and seeking | **11 passed** |
| Short-video capture assertions | **21 passed** |
| Full-tutorial capture assertions | **27 passed** |
| JavaScript syntax checks | Passed for app, state mapping and player |
| Clean packaged startup, static media, hashes and encoding | **21 passed** |

The browser suites have overlapping scenarios; their counts are assertions, not a claim of that many independent real-world rescues. The quick journey additionally checks omitted-checkbox blocking and cancellation. No JavaScript page errors were recorded in the passing suites.

The one Python skip is the optional OpenAI-SDK client test because `openai` was not installed in this restricted environment. Dependency installation was attempted but outbound package resolution was unavailable. The app's deterministic fallback was exercised; external model inference was not. The dependency remains correctly listed in requirements.txt for a normal installation.

## What the browser checked

Fresh report entry, explicit draft confirmation, the PKR 3,000 first offer against a PKR 2,000 budget, an explicit second inquiry, the PKR 1,500 alternative, unchanged selection until the reporter chooses, selected-helper-only approval, checkbox/cancel boundaries, helper confirmation, explicit progress and saved safe closure.

Regression coverage includes unresolved conditions, incomplete callback price, manual retry, failed requests, preserved earlier evidence, live-control rendering fixtures, blocked retry under provider uncertainty, keyboard focus restoration, reduced motion and no automatic travel/arrival. Rendering-only live fixtures were cancelled; they did not submit live requests.

App layouts were checked at 320, 390, 640, 1280 and 1600 pixels. The player was checked at 320, 390, 760 and 1440 pixels. No horizontal overflow was found in those tested states. This is not a claim of exhaustive accessibility or every-device testing.

The actual MP4 files decoded in Chromium, remained paused on load and on mode change, played after chapter clicks and allowed seeking to the last tutorial chapter. Media requests were served from the real isolated HTTP server.

## Video assets

- Submission demo: **161.933333 seconds (2:42 rounded)**.
- Complete tutorial: **261.3 seconds (4:21 rounded)**.
- Both: **1600 × 900, H.264, yuv420p, 30 fps**, caption-led, no audio track.
- Captions occupy an 80-pixel band below the 1600 × 820 app viewport.
- English SRT/VTT, actual chapter timestamps and file hashes are included.

The source encoder's full-range video was normalised before adding the caption band so the original forest/sage UI remains visually consistent. The recorder now handles this conversion directly. App frames and timings were not replaced with mock-ups. Representative beginning, comparison, approval, confirmation and completion frames were inspected.

## Browser-environment limitation

Direct Chromium navigation was blocked by the execution environment. The existing documented `BROWSER_HTTP_BRIDGE=1` harness loaded the real app HTML/CSS/JS inline and forwarded requests to a real isolated HTTP API. All recorded app actions used the real UI and API; no successful case state or provider response was injected into the published journey.

The bridge does **not** establish normal-origin session-storage behaviour, browser enforcement of production CSP/origin headers or a deployed public environment. HTTP security behaviour is covered by application tests; native production-browser enforcement needs a normal local or deployed browser. The draft message correctly reflects unavailable storage in the bridged recording.

## Source and packaging

Every top-level backend Python module is byte-for-byte unchanged from the user-supplied archive, except app.py's 5.3.6 → 5.4.0 version strings. The source comparison is included. No schema, contact-selection policy, call transport, pricing guard, approval guard, retry policy or progress transition was changed.

The Dockerfile previously omitted runtime modules. It now copies all top-level Python modules. Local Python startup, module inclusion, static assets and the complete browser flow were checked. The clean packaged source was also started with a fresh temporary database: version, default mode, three sample contacts, security headers, all player assets, real HTTP byte-range media serving and media hashes/encoding passed. Test-only phone fixtures were normalised to synthetic destinations; the final Python suite was rerun with 517 passes and the same one optional-SDK skip. Docker image construction, dependency installation from scratch on another machine, hosted deployment and upstream repository validation were not executed here.

Historical suite filenames are preserved for traceability. Their original result JSON may carry their earlier suite-version label; these checks were run against the current 5.4.0 UI. The source-only version-marker assertion was updated to match the release.

## Not performed

No actual CALL-E call, external-model inference, real rescue, public hosting, repository PR creation, video upload or Devpost submission. No credential or private phone number is supplied. Provider-backed verification remains an explicit, consented local step in submission/LIVE_VERIFICATION.md.

The original ZIP is unchanged. The clean kit omits old patch manifests, upgrade chains, cached databases, raw recordings, dependencies, private evidence and obsolete screenshots. Evidence in this folder is curated from the passing runs; it is not a claim of a clean public deployment.
