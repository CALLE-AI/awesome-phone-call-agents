#!/usr/bin/env python3
"""Thin wrapper around the late-hold-triage skill runner."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SKILL = (
    Path(__file__).resolve().parents[3]
    / "skills"
    / "late-hold-triage"
    / "scripts"
    / "triage_late_hold.py"
)
SAMPLE = (
    Path(__file__).resolve().parents[3]
    / "skills"
    / "late-hold-triage"
    / "assets"
    / "sample_holds.csv"
)


def main(argv: list[str]) -> int:
    if not argv:
        argv = [
            "--in",
            str(SAMPLE),
            "--now",
            "2026-09-12T19:12:00-04:00",
        ]
    if argv[:1] == ["--live"]:
        argv = argv[1:] + ["--confirm"]
    return subprocess.call([sys.executable, str(SKILL), *argv])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
