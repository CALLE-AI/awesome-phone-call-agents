# Dependency and asset boundary

This app's source is MIT licensed under [LICENSE](LICENSE), consistent with the
upstream repository's MIT license. No SDK implementation, installed distribution,
third-party media, logo, screenshot, font, or private repository history is
vendored. Dependency names below describe separate installations, not code
relicensed by this app.

## Direct dependencies

| Dependency | Version constraint | Observed license evidence |
| --- | --- | --- |
| FastAPI | 0.139.2 | MIT |
| Uvicorn | 0.51.0 | BSD-3-Clause |
| HTTPX | 0.28.1 | BSD-3-Clause |
| CALL-E Python SDK (`calle-ai`, optional) | 0.6.0 | MIT attribution in an existing upstream app; SDK distribution metadata undeclared (see boundary below) |
| setuptools (build only) | >=69 | MIT; bundled tooling distribution 84.0.0 inspected separately, not vendored |

## CALL-E SDK evidence and external-dependency boundary

The following observations were checked on 2026-09-01 and are distinct claims:

1. [PyPI](https://pypi.org/project/calle-ai/0.6.0/) distributes version 0.6.0 as
   the CALL-E Python server SDK. Its [version-specific metadata](https://pypi.org/pypi/calle-ai/0.6.0/json)
   reports `license = null`, `license_expression = null`, and `license_files = null`.
   The SDK repository linked by PyPI, [CALLE-AI/server-sdk-python](https://github.com/CALLE-AI/server-sdk-python),
   was not publicly accessible at the time of this check. The reason is unknown.
2. The [official integrations guide](https://github.com/CALLE-AI/call-e-integrations#sdk)
   instructs users to install `calle-ai` and use `CalleClient` and
   `client.calls.create_and_wait`. At upstream revision
   `e09169940dfd45dda190c649cd46517ed735b9b1`, the existing
   [webhook-result-receiver dependency declaration](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/e09169940dfd45dda190c649cd46517ed735b9b1/apps/python/webhook-result-receiver/pyproject.toml)
   pins `calle-ai==0.6.0`, while [IncidentBridge's third-party notice](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/e09169940dfd45dda190c649cd46517ed735b9b1/apps/python/incidentbridge/THIRD_PARTY.md)
   attributes CALL-E `calle-ai` to MIT. This is observed upstream attribution,
   not independent proof from the SDK's own LICENSE file.
3. This app only declares the pinned SDK as an optional external dependency.
   It does not vendor or copy SDK implementation code, redistribute a wheel or
   source distribution, or supply an SDK LICENSE file. It uses the published
   public client/Calls interface, checked against the installed 0.6.0 contract.
   The default Fake Provider path does not import or require the SDK.

Given the same official upstream repository's existing use of the identical
external dependency/version, the residual metadata gap is recorded as non-blocking
for this local candidate commit under the project owner's explicit authorization.
This does not establish the SDK's license independently, authorize SDK
redistribution, or replace a separate publication review. Do not infer the SDK's
license from this app's MIT LICENSE or from the upstream root MIT LICENSE.

## Transitive dependencies observed in the local verification environment

The inspected metadata reports MIT for attrs, Pydantic, pydantic-core,
typing-inspection, annotated-doc, h11, AnyIO, and annotated-types; BSD-3-Clause for
Starlette, Click, httpcore, and idna; PSF-2.0 for typing-extensions; and MPL-2.0 for
certifi. Colorama reports the BSD classifier. These packages are independently
installed, not copied or modified here. This inventory is not a lockfile: fresh
resolution may select other compatible transitive versions. Preserve the
respective notices when separately distributing dependencies.
