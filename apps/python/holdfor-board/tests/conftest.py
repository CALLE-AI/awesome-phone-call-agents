from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from holdfor import db, seed as seeding
from holdfor.providers import FakeProvider


@pytest.fixture
def fixtures_dir():
    return Path(__file__).resolve().parents[1] / "fixtures" / "transcripts"


@pytest.fixture
def today():
    return date(2026, 8, 20)


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
