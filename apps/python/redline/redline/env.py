"""Load a ``.env`` file, without adding a dependency to do it.

Until this existed, `.env.example` told people to copy the file and fill it in,
and nothing read the result. The credential only worked if it was already
exported in the shell -- which is not what the instructions said, and is the
kind of gap you discover with a live key in your hand.

Deliberately small, and deliberately not `python-dotenv`. The format REDLINE
needs is `KEY=value` with comments; a dependency for that is a dependency a
security tool has to ask people to trust, in exchange for nothing.

**Real environment variables always win.** A value already exported is a
deliberate act -- a CI secret, a one-off `REDLINE_CALLE_API_KEY=... redline
run` -- and a file on disk must not silently override it.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

__all__ = ["DOTENV_FILENAME", "find_dotenv", "load_dotenv", "parse_dotenv"]

DOTENV_FILENAME = ".env"


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse the subset of the format REDLINE uses.

    Supports ``KEY=value``, ``export KEY=value``, ``#`` comments, blank lines,
    and optional single or double quotes around the value. Anything more
    elaborate -- interpolation, multi-line values -- is not supported, and a
    line that cannot be read is skipped rather than guessed at.
    """
    values: dict[str, str] = {}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()

        key, separator, value = line.partition("=")
        if not separator:
            continue

        key = key.strip()
        if not key or not key.replace("_", "").isalnum():
            continue

        value = value.strip()
        # Strip one matching pair of quotes; do not touch anything else, so a
        # value that legitimately contains a quote survives.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]

        values[key] = value

    return values


def find_dotenv(start: Path | None = None) -> Path | None:
    """Look for a ``.env`` beside the config, then upwards to the repo root.

    Walking up matters because `redline run --config examples/x/redline.yaml`
    is run from the repository root, where the credential lives, not from the
    example directory.
    """
    current = (start or Path.cwd()).resolve()
    if current.is_file():
        current = current.parent

    for directory in (current, *current.parents):
        candidate = directory / DOTENV_FILENAME
        if candidate.is_file():
            return candidate
        # Stop at a repository boundary rather than wandering into a parent
        # project that happens to have a .env of its own.
        if (directory / ".git").exists():
            break

    return None


def load_dotenv(
    path: Path | None = None,
    *,
    environ: dict[str, str] | None = None,
) -> tuple[Path | None, Mapping[str, str]]:
    """Load a ``.env`` into the environment and report what came from it.

    ``path=None`` means **search from the current directory**, not "no file".
    A caller that has already resolved a location and found nothing must not
    pass None: it would start a fresh search from somewhere else entirely.

    Returns the file that was read (or ``None``) and the values it defined --
    *all* of them, including ones that were not applied because the variable
    was already set. `redline doctor` needs to be able to say "this is in your
    file but your shell is overriding it", which is a genuinely confusing
    state to be in otherwise.
    """
    target = environ if environ is not None else os.environ

    resolved = path if path is not None else find_dotenv()
    if resolved is None or not resolved.is_file():
        return None, {}

    try:
        values = parse_dotenv(resolved.read_text(encoding="utf-8"))
    except OSError:
        return None, {}

    for key, value in values.items():
        target.setdefault(key, value)

    return resolved, values
