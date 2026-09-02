#!/usr/bin/env python3
"""Skill-local preview wrapper. Places no calls."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps/python/appointment-confirm"
ASSET = Path(__file__).resolve().parents[1] / "assets" / "sample-appointment.json"
sys.path.insert(0, str(APP))

from client import main

if __name__ == "__main__":
    argv = sys.argv[1:] or ["--request", str(ASSET), "--preview"]
    raise SystemExit(main(argv))
