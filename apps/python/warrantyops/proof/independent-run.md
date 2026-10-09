# Independent run — status: NOT independently run

**As of 2026-09-12 no third party has run this repository, and no fork or
clone has been pushed or published.** The build directive under which this
tree was produced froze push, publication and submission, so the
independent-run row of the architecture's evidence table is deliberately
**unmet**: this file publishes the procedure any third party can follow and
holds an intentionally empty record for the first independent runner. Nothing
below claims a run that did not happen.

The procedure needs no private developer context and no live key: no
`CALLE_API_KEY`, no pre-seeded database, no owner-local files. The whole path
is offline with respect to CALL-E — the one live-shaped leg
(`make contract-live`) refuses by design without the live environment.

## What a third party runs

```bash
git clone <repository url> warrantyops-verify
cd warrantyops-verify/apps/python/warrantyops

python3.9 -m venv .venv            # any Python >= 3.9 works for the core
. .venv/bin/activate
pip install -e ".[dev]"            # pinned toolchain; pip-audit needs network

pytest -q                          # the deterministic suite
make check PYTHON=python           # the full release gate
```

Expected: `pytest -q` reports every test passed with none skipped for a
missing tool; `make check` prints `check: all gates green` (validator,
byte-identical proof screen and adversarial page, generated-docs identity,
all scenarios, `git diff --check`, hypothesis-present, branch coverage at
its 95% floor, mypy --strict, ruff, pip-audit with the one documented
accepted advisory).

The offline judge path adds one external leg:

```bash
make judge PYTHON=python HYGIENE_AUDIT=/path/to/repo_hygiene_audit.py
```

The repository hygiene audit tool is the owner's and deliberately lives
outside this repository, so a third party cannot run that leg without it;
without `HYGIENE_AUDIT` the judge target stops with a named message instead
of silently skipping (`exit 2`). Every other judge leg — suite, repository
validator, byte-identical proof screen, adversarial page, scenarios,
`git diff --check` — is already covered by `make check` above.

## Author-side verification (not an independent run)

What has actually been executed, by the author, on this tree — recorded so
the first independent runner has something to compare against. This is not
third-party evidence and is not counted as such anywhere.

- **Date:** 2026-09-12
- **Environment:** macOS (Darwin 25.6.0), CPython 3.9.6, the `[dev]` pins
  from `pyproject.toml` installed in a dedicated virtualenv.
- **Commands and results:** the full gate suite — `pytest -q`,
  `scripts/validate_repository.py`, proof-screen and adversarial-page
  byte-identity, generated-docs identity, all CLI scenarios,
  `git diff --check`, mypy --strict, ruff, pip-audit, branch coverage at
  floor, and the owner's external hygiene audit — all green. Exact counts
  are re-derived by running the commands above; this file pins artifacts,
  not test counts.
- **Public artifact digests (author, 2026-09-12):**

| Artifact | sha256 |
| --- | --- |
| `proof/w1042-proof.html` | `2c20e750bbe2d3e792025b28f86cc63f601c5621f947902fb3c6835126bcbd51` |
| `proof/w1042-proof.json` | `effc84805eb5eca0e180f5780b372099e0d6fefa8496f4ffefd8990f1f26a3dc` |
| `proof/runtime-proof-receipt.public.json` | `39af336370484ecc166c384d352ba1c2e1710d5ccd461472bf33cba69e6fb6fc` |
| `proof/adversarial.html` | `47c0c4349ff71091bcbb31b7a7957a04ba7855513344b101f6e8a7600aeb7300` |

  The rendered artifacts are byte-deterministic by construction, so an
  independent runner's digests should match these exactly; a mismatch is a
  finding, not a tolerance.

## Signed-out link check

Every external link cited in `docs/why-the-phone.md` was fetched
successfully **while signed out of every service** on 2026-09-12 — no
account, cookie or key of any kind was required to read the cited sources.

## Third-party run record — intentionally empty

The first independent runner fills this in; nobody pre-fills it for them.

| Field | Value |
| --- | --- |
| Runner (name/handle) | — |
| Date of run | — |
| Environment (OS, Python) | — |
| Commit / tree state | — |
| Commands run | — |
| pytest result | — |
| `make check` result | — |
| Artifact digests observed | — |
| Anomalies | — |
