"""Run the fixture validator as part of the suite.

Keeps `pytest` a single entry point: schemas, phone masking, AI disclosure and
the reconciliation against expected/ all get checked without remembering a
second command.

Refs #19.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]


def test_fixtures_are_valid():
    result = subprocess.run(
        [sys.executable, str(APP_ROOT / "fixtures" / "validate_fixtures.py")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
