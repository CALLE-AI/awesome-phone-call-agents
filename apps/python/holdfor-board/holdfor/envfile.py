"""Read `.env` into the environment, once, at the top of a command.

Every setting in this app is an environment variable, and the numbers are the two that
matter most: which phone the board is aimed at, and which line a Rebooking Call dials.
Both lived in `.env` with nothing to read them, so the only way to get them into a
process was `set -a; source .env; set +a` before every launch — and a server started in
a shell that had not done it refused every Rebooking Call with `no_booking_line`, which
looks exactly like a broken button.

Three rules make this safe to run without thinking about it:

An existing variable always wins. Nothing here overwrites what somebody typed on the
command line, so `CALLE_LIVE=1 python -m holdfor serve` still means what it says and a
file can never quietly countermand it.

`CALLE_LIVE` is never read from the file at all. Config comes from `.env`; arming a
real phone call is typed each time. See `NEVER_FROM_FILE`.

It is called from `__main__` and nowhere else. `create_app` stays a function that reads
the environment it was given, so the test suite and anything importing this package are
unaffected by a file happening to sit in the working directory.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT = ".env"

QUOTES = ("'", '"')

# Never read from a file, however it is written there. Config comes from `.env`; arming
# a real phone call is typed on the command line, once, every time somebody means to
# spend one of the twenty. That property is the whole reason `CALLE_LIVE` sits
# commented out in `.env` and is documented as such in `.env.example` — and a comment
# is not a safeguard, because uncommenting it is one keystroke and a file that armed
# live calls by being present would make `python -m holdfor call 2` mean something
# different depending on a file nobody looked at. Skipped by name so it cannot.
NEVER_FROM_FILE = frozenset({"CALLE_LIVE"})


def parse(text: str) -> dict[str, str]:
    """The KEY=VALUE lines, and nothing clever.

    No interpolation, no `export`, no multi-line values. A settings file for this app
    holds a database path and three phone numbers; a parser that understood more than
    that would be a parser that could surprise somebody about which number is loaded.
    """
    found: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        if not name:
            continue
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in QUOTES:
            value = value[1:-1]
        found[name] = value
    return found


def load(path: str | Path = DEFAULT) -> list[str]:
    """Fill in what the environment does not already have. Returns the names set.

    A missing file is the normal case, not an error: nothing in this app requires a
    `.env` and the defaults are what a fresh checkout runs on.
    """
    settings = Path(path)
    if not settings.is_file():
        return []

    filled = []
    for name, value in parse(settings.read_text(encoding="utf-8")).items():
        if name in NEVER_FROM_FILE or os.environ.get(name) is not None:
            continue
        os.environ[name] = value
        filled.append(name)
    return filled
