# Continuous integration and the PR matrix table

`.github/workflows/warrantyops-quality.yml` runs two jobs over the full
matrix — Ubuntu, macOS, Windows × Python 3.9, 3.11, 3.12, 3.13
(architecture gate F8):

- **judge** — the offline path a stranger can run from a fresh clone:
  the suite, the repository validator, byte-identical proof screen,
  scenario sweep, and `git diff --check`. The whole-repository hygiene
  audit is owner-side by design (its tool lives outside the repository);
  its in-repo machine-checked half runs inside the suite.
- **check** — the release gate: everything in `make check`, i.e. the above
  (as `make quality` legs) plus generated-docs byte-identity, the 95%
  branch-coverage floor, the hypothesis presence guard, `mypy --strict`,
  `ruff`, and `pip-audit` against `audit-requirements.txt`.

Every matrix cell installs the exact pinned toolchain
(`pytest==8.4.2 hypothesis==6.141.1 mypy==1.14.1 ruff==0.9.4
coverage==7.6.1 pip-audit==2.7.3`) so judge environments use the same pins
the audit file verifies (P13), then the package itself with `--no-deps`
(runtime dependencies are zero). Windows installs GNU make via Chocolatey;
the Makefile forces `SHELL := bash` (Git for Windows ships it) because the
scenario sweep is a POSIX shell loop.

The workflow file has not been pushed or executed under this build's
authorization (no push, per the standing directive) — the table below is
what the owner pastes into the PR body once CI has actually run, filled
with the real results at that time.

## PR matrix table (template)

| Gate | Ubuntu 3.9 | Ubuntu 3.11 | Ubuntu 3.12 | Ubuntu 3.13 | macOS 3.9 | macOS 3.11 | macOS 3.12 | macOS 3.13 | Windows 3.9 | Windows 3.11 | Windows 3.12 | Windows 3.13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `make quality scenarios diff-check` (judge, offline) | | | | | | | | | | | | |
| `make check` (release: static + coverage + docs + audit) | | | | | | | | | | | | |
| Cassette replay (when cassettes exist) | | | | | | | | | | | | |

Locally verified under this build: `make check` and `make judge` green on
macOS / Python 3.9.6 (pinned environment), including the external hygiene
audit with its allowlist.
