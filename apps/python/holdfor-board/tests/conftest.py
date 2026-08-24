from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path

import pytest

from holdfor import db, envfile, seed as seeding
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


@pytest.fixture(autouse=True)
def never_calls_out(monkeypatch):
    """No test may reach the Anthropic API either, however the machine is configured.

    The second-pass extractor is gated on a key being present, so a developer who
    exported one must not thereby turn the suite into something that costs money, goes
    over the network, and answers differently on Tuesday. A test that wants the
    extractor supplies its own answers.
    """
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("HOLDFOR_EXTRACT_MODEL", raising=False)


@pytest.fixture(autouse=True)
def never_reads_a_settings_file(monkeypatch, tmp_path):
    """No untracked file on one developer's machine decides what the suite proves.

    `main` loads `.env` and `test_cli` calls `main`, so the first CLI test used to put
    a real `.env` into `os.environ` for the rest of the process — and monkeypatch
    cannot unwind what it did not set. A booking line leaking out of it turned
    `test_no_booking_line_means_no_call` into a pass or a fail depending on which test
    ran first.

    Closed twice over, because the two close different holes. Moving the default path
    means the file is never read at all, including inside the test that calls `main`;
    the loader itself is still the real one, so a test may point it at a file it wrote.
    Clearing the settings covers the other way in — a variable somebody exported in the
    shell they happen to be running the suite from.
    """
    monkeypatch.setattr(envfile, "DEFAULT", str(tmp_path / "absent" / ".env"))
    for name in [
        setting for setting in os.environ if setting.startswith("HOLDFOR_")
    ]:
        monkeypatch.delenv(name, raising=False)


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
