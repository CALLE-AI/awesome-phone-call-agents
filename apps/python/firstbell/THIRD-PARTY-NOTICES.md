# Third-party notices

Every dependency and every piece of externally sourced material, with its licence. Kept
because the hackathon rules require that an entrant "must be authorized to use them in
accordance with any terms and conditions or licensing requirements of the tool", and
because a reader should be able to check that claim rather than take it.

## Runtime dependencies

| Package | Version | Licence | Where the licence was checked |
|---|---|---|---|
| `calle-ai` | 0.7.0 | **None declared** | See the note below. This is not an omission on our part. |
| `httpx` | transitive, via `calle-ai` | BSD-3-Clause | PyPI metadata |

Nothing else is required at runtime. The test double and the dispatcher use only the
Python standard library plus `httpx`, which arrives with the SDK.

## Development dependencies

| Package | Licence |
|---|---|
| `pytest` | MIT |

## The `calle-ai` licence situation

The official CALL-E Python SDK, which the platform's own quickstart instructs developers
to install, declares no licence:

- `info.license` on PyPI is null, as is `info.license_expression`
- there are no licence classifiers
- the installed distribution contains no `LICENSE` file
The package's declared Home-page, `https://github.com/CALLE-AI/server-sdk-python`, is a
separate matter and it has since been settled. This file used to say it returned 404 and was
absent from the CALL-E organisation's public repository list, which was true when it was
written on 2026-09-04. Re-checked on 2026-09-09 it answers **200**, it is public, and it
carries an MIT licence reading `Copyright (c) 2026 CALL-E, Inc.`, pushed 2026-09-08. That
half of the report is withdrawn.

What has not changed is the PyPI metadata above: the published distribution still declares no
licence and ships no `LICENSE` file, so a developer who follows the quickstart and installs
from PyPI, which is what the quickstart tells them to do, still receives an unlicensed
artifact. The repository being MIT does not license the package that was already published.

Our position, stated plainly rather than assumed: this project uses `calle-ai` exactly as
the platform's own installation guide and quickstart direct, inside a hackathon run by the
package's publisher, for the purpose that publisher invited. We hold no licence beyond that
implied invitation, and we redistribute no part of the SDK. It is declared as an ordinary
PyPI dependency and installed from PyPI by the end user.

This was reported to CALL-E through the hackathon's feedback channel, with the suggested fix
of adding the MIT licence to match the TypeScript SDK. Part of it has been acted on already:
the repository is public and MIT as of 2026-09-08. The remaining ask is the smaller one, that
the same licence reach the PyPI metadata and the built distribution.

## Reference data

The supported regions and languages table reproduced in `calle_double/regions.py` is
transcribed from the "Supported regions and languages" section of
[CALLE-AI/call-e-integrations](https://github.com/CALLE-AI/call-e-integrations), published
under the MIT licence, Copyright (c) 2026 CALL-E contributors.

It is reproduced as factual reference data so the test double rejects the same
destinations the real service rejects. A double that accepted numbers the service refuses
would hand a developer a false pass.

## Phone numbers

Every phone number in this repository is fictional and none is ever dialled. India numbers
use the `+91 555` prefix, which is not allocated to Indian subscribers, whose national
numbers begin 6 to 9 for mobile. North American examples use the `+1 555 01xx` block
reserved for fictional use. See `tests/fixtures.py`.
