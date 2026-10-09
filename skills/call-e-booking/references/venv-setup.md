# Python venv setup for Hermes skills (macOS with PEP 668)

When a Hermes skill needs a Python package that the system `python3` can't
install (PEP 668 "externally-managed-environment", or the system Python is too
old), create a dedicated venv inside the skill directory.

## The pattern

1. **Find a suitable Python.** On macOS the system `/usr/bin/python3` may be
   too old (3.9.x is common). Hermes's own venv (`~/.hermes/hermes-agent/venv/bin/python3`)
   is typically Python 3.11+ and can create venvs. Homebrew pythons
   (`python3.11`, `python3.12`, etc.) also work.

2. **Create the venv:**
   ```bash
   PY311=~/.hermes/hermes-agent/venv/bin/python3
   $PY311 -m venv ~/.hermes/skills/<skill>/.venv
   ```

3. **Install dependencies:**
   ```bash
   ~/.hermes/skills/<skill>/.venv/bin/pip install <package>
   ```

4. **Reference in SKILL.md** — always invoke scripts through the venv Python,
   never the system `python3`:
   ```bash
   PY="$HOME/.hermes/skills/<skill>/.venv/bin/python3"
   $PY script.py ...
   ```
   Script shebangs (`#!/usr/bin/env python3`) stay portable; the SKILL.md
   routes through `$PY` so the correct interpreter is always used.

## Why a dedicated venv (not the Hermes venv)

- Hermes may recreate its own venv on update, wiping user-installed packages.
- The skill stays self-contained and portable between profiles.
- Avoids version conflicts between skills with different dependency needs.

## Common pitfalls

- **`python3 --version` lies**: `/usr/bin/python3` may report 3.9.x while
  Hermes itself runs 3.11.x in a venv. Always verify with the venv Python
  you plan to use: `~/.hermes/hermes-agent/venv/bin/python3 --version`.
- **PEP 668**: `pip install` directly on macOS system Python fails with
  "externally-managed-environment." A dedicated venv sidesteps this —
  `pip install` always works inside a venv.
- **Stdlib-only scripts**: scripts that use only Python stdlib (no third-party
  packages) run fine on the system `python3` too. Only use the venv when
  needed — for this skill, `plan` works without it but `book` and `status`
  need it for the `calle-ai` SDK import.