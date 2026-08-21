from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import pytest

from holdfor import db, seed as seeding
from holdfor.providers import FakeProvider


@pytest.fixture
def fixtures_dir():
    return Path(__file__).resolve().parents[1] / "fixtures" / "transcripts"


@pytest.fixture(autouse=True)
def never_live(monkeypatch):
    """No test may place a real phone call, however the machine is configured.

    `FakeProvider` is the default because `CALLE_LIVE` is absent, so a developer
    who exported it for a calibration call must not thereby turn the whole suite
    live. Autouse: this is not something a test opts into.
    """
    monkeypatch.delenv("CALLE_LIVE", raising=False)


@pytest.fixture
def today():
    return date(2026, 8, 20)


@pytest.fixture
def now(today):
    """A Thursday at 11:00 — inside the Reading Window, on the day the seeded
    day-3 appointments come due.

    Pinned so that the suite proves the Reading Window rather than depending on
    it: with the real clock, every check-in test would pass only between 10:00
    and 16:00 on one weekday of one week.
    """
    return datetime(today.year, today.month, today.day, 11, 0)


@pytest.fixture
def db_path(tmp_path, today):
    path = str(tmp_path / "test.db")
    connection = db.connect(path)
    db.init(connection)
    seeding.seed(connection, today=today)
    connection.close()
    return path


@pytest.fixture
def conn(db_path):
    connection = db.connect(db_path)
    yield connection
    connection.close()


@pytest.fixture
def provider(fixtures_dir):
    return FakeProvider(fixtures_dir=fixtures_dir)
