# Third-party notices

Every dependency and every piece of externally sourced material, with its licence. Kept
because the hackathon rules require that an entrant "must be authorized to use them in
accordance with any terms and conditions or licensing requirements of the tool", and
because a reader should be able to check that claim rather than take it.

## Runtime dependencies

`requirements.txt` names two packages. Installing those two pulls in six more, and this
table is the whole closure rather than the part that was typed by hand. Every version and
every licence below was read from the installed distribution's own metadata on 2026-09-09,
not from memory and not from a package page.

| Package | Version | Required by | Licence | Read from |
|---|---|---|---|---|
| `calle-ai` | 0.7.0 | `requirements.txt` | **None declared** | See the note below. This is not an omission on our part. |
| `attrs` | 26.1.0 | `calle-ai` | MIT | `License-Expression` in the installed metadata |
| `httpx` | 0.28.1 | `requirements.txt`, and `calle-ai` | BSD-3-Clause | `License` in the installed metadata |
| `anyio` | 4.14.1 | `httpx` | MIT | `License-Expression` |
| `certifi` | 2026.1.4 | `httpx`, `httpcore` | MPL-2.0 | `License` plus an OSI classifier |
| `httpcore` | 1.0.9 | `httpx` | BSD-3-Clause | `License-Expression` plus an OSI classifier |
| `h11` | 0.16.0 | `httpcore` | MIT | `License` plus an OSI classifier |
| `idna` | 3.11 | `httpx`, `anyio` | BSD-3-Clause | `License-Expression` |

Two more arrive on older interpreters, because `anyio` asks for them by marker. This
project supports Python 3.10 and up, so both are reachable and both are listed rather than
left out for not being installed on the machine that wrote this file. Their licences were
read from the published wheels on 2026-09-09: `typing_extensions` 4.16.0 (PSF-2.0) on
Python below 3.13, and `exceptiongroup` 1.3.1 (MIT) on Python below 3.11.

`certifi` is the one that is not permissive. MPL-2.0 is file-level copyleft: it asks that
modifications to certifi's own files be published under the same licence, and it says
nothing about the software that imports it. Nothing here modifies it, and it is installed
from PyPI by the end user rather than redistributed, so the obligation is not engaged. It
is named because a reader auditing a dependency tree should find the awkward row already
written down instead of finding it themselves.

Nothing outside this table is needed to run the dispatcher. The test double and the
dispatcher use the Python standard library plus what the table lists.

## Development dependencies

None of these ship to anybody. They build the page, run the suite and drive the browser
gates, and a reader running the software needs none of them.

| Package | Version | Licence |
|---|---|---|
| `pytest` | 9.1.1 | MIT |
| `iniconfig` | 2.3.0 | MIT |
| `packaging` | 26.0 | Apache-2.0 OR BSD-2-Clause |
| `pluggy` | 1.6.0 | MIT |
| `pygments` | 2.19.2 | BSD-2-Clause |
| `colorama` | 0.4.6 | BSD-3-Clause |
| `markdown-it-py` | 4.2.0 | MIT |
| `mdurl` | 0.1.2 | MIT |
| `lottie` | 0.7.2 | **AGPL-3.0-or-later**. See the note below |

The browser gates run on Node. `tools/gates/package.json` pins one package,
`puppeteer-core` 23.11.1 (Apache-2.0), and `package-lock.json` resolves 83 more. All 84
were read out of the installed tree on 2026-09-09 and every one is permissive: MIT,
Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause or 0BSD. None is copyleft. `node_modules/` is
not tracked, so what this repository carries is the lock file that names them.

## The `lottie` licence situation

`tools/make_figure.py` draws the three-endings figure by importing the Python `lottie`
package, which is published under AGPL-3.0-or-later. That is the only copyleft licence
anywhere in this project, and this repository is MIT, so the pairing is worth stating
plainly rather than leaving for a reviewer to find.

What is and is not happening, as precisely as we can put it:

- `lottie` is a development dependency. It is installed from PyPI by whoever rebuilds the
  page, and no part of it is copied into this repository or served to a reader.
- The figure the page plays is drawn by our own code and written out in the Lottie
  interchange format, which is a published format rather than a piece of the library. The
  shipped artifact carries no `lottie` source.
- The player in the browser is a different project with a different licence: `lottie-web`
  5.13.0, MIT, vendored with its digest in `tools/site/vendor/VENDOR.json`.
- AGPL section 13 is about users interacting with the program over a network. Nothing here
  runs `lottie` on a server. It runs once on a laptop during a build.

The part we do not claim to have settled is whether a source file that imports an AGPL
library is itself reached by that licence when it sits in an MIT repository. Opinions
differ on Python imports, and this project is not the right place to decide it. The
practical position: `make_figure.py` is published in full alongside the library it calls,
which is what the AGPL exists to guarantee, and if the maintainer would rather this
contribution carried no AGPL import at all, the figure can be emitted as Lottie JSON
directly with no dependency. Say so on the pull request and it comes out.

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

This goes to CALL-E through the hackathon's feedback survey, with the suggested fix of
adding the MIT licence to match the TypeScript SDK. That survey is filed outside this
repository, so it is the one line in this file a reader cannot open and check. Part of it
has been acted on already: the repository is public and MIT as of 2026-09-08. The remaining
ask is the smaller one, that the same licence reach the PyPI metadata and the built
distribution.

## What the published page loads

The evidence page is a static file. Three things on it come from somebody else, and the
build pins all three.

| Asset | Version | Served from | Licence |
|---|---|---|---|
| `lottie-web`, light build | 5.13.0 | this origin, vendored | MIT |
| `lenis` | 1.1.18 | `cdn.jsdelivr.net` | MIT |
| Adobe Fonts kit `qdx4jvs` | n/a | `use.typekit.net` | Adobe Fonts terms, tied to the account that made the kit |

`lottie-web` is copied into the output directory from `tools/site/vendor/`, where
`VENDOR.json` records the package, the version, the exact URL it was fetched from and the
sha256 of the bytes, so a file that changed without a version change fails the suite
instead of reaching a browser. `lenis` is loaded from a CDN with a subresource integrity
hash recomputed from what that URL actually serves, and the page falls back to native
scrolling if the bytes ever differ. The Adobe Fonts kit is a hosted service rather than a
file this project redistributes: the fonts are not in this repository and are not copied
anywhere by the build.

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
