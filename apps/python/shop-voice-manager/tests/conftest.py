"""Shared test setup.

Puts the app on the import path once, so test modules do not each have to, and
provides the two ledgers most tests need.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = APP_ROOT / "fixtures"

if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from demo_ledger import build  # noqa: E402


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture(scope="module")
def ledger(tmp_path_factory):
    """The seven clean days, as the summary sees them."""
    conn = _open(build(tmp_path_factory.mktemp("ledger") / "shop.db"))
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def full_ledger(tmp_path_factory):
    """The same, plus the five bad-outcome calls."""
    conn = _open(build(tmp_path_factory.mktemp("ledger_edge") / "shop.db",
                       include_edge_cases=True))
    yield conn
    conn.close()
