#!/usr/bin/env python3
"""Refuse REDLINE's private input files if they are staged.

`.gitignore` prevents an ordinary `git add`, but `git add -f` bypasses it. This
hook checks the index itself and rejects the two files that intentionally hold
credentials or real-world authorisation data, wherever they appear in a repo.
It never opens either file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath

PRIVATE_NAMES = frozenset({".env", "redline.scope.yaml"})


def private_staged_paths(paths: list[str]) -> list[str]:
    """Return staged paths whose basename is a REDLINE private input."""
    return sorted(
        path
        for path in paths
        if PurePosixPath(path.replace("\\", "/")).name in PRIVATE_NAMES
    )


def staged_paths() -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise RuntimeError("git could not read the staged file list")
    return [
        item.decode("utf-8", errors="surrogateescape")
        for item in completed.stdout.split(b"\0")
        if item
    ]


def main() -> int:
    try:
        blocked = private_staged_paths(staged_paths())
    except (OSError, RuntimeError) as error:
        print(
            f"REDLINE pre-commit: {error}; refusing an unscanned commit.",
            file=sys.stderr,
        )
        return 1

    if not blocked:
        return 0

    print("REDLINE pre-commit: private input file staged:", file=sys.stderr)
    for path in blocked:
        print(f"  {path}", file=sys.stderr)
    print(
        "Unstage it and keep it ignored. These files may contain credentials, "
        "real phone numbers, and authoriser contact data.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
