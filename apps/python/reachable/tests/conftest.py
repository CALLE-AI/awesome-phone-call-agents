"""Shared fixtures. Nothing here opens a socket or reads a credential."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from fake_calle.server import FakeCalleClient, FakeCalleState
from reachable.config import Config
from reachable.orchestrator import Orchestrator
from reachable.store import Store

APP_ROOT = Path(__file__).resolve().parent.parent
SAMPLE = APP_ROOT / "sample_data"
LONDON = ZoneInfo("Europe/London")

#: A Friday in the sample calendar, inside the 09:00-16:00 window.
SCHOOL_DAY_IN_WINDOW = datetime(2026, 9, 11, 10, 30, tzinfo=LONDON)
#: Same day, after the window closes.
AFTER_HOURS = datetime(2026, 9, 11, 19, 30, tzinfo=LONDON)
#: A Saturday.
NON_SCHOOL_DAY = datetime(2026, 9, 12, 10, 30, tzinfo=LONDON)

BASE_ENV = {
    "REACHABLE_DATA_DIR": str(SAMPLE),
    "REACHABLE_CALLE_BASE_URL": "http://127.0.0.1:8787",
    "REACHABLE_TERM_ID": "2026-autumn",
}


@pytest.fixture
def env() -> dict[str, str]:
    return dict(BASE_ENV)


@pytest.fixture
def live_env(env: dict[str, str]) -> dict[str, str]:
    """Live calls enabled, but the transport is still the in-process fake."""
    env["REACHABLE_LIVE_CALLS"] = "1"
    return env


@pytest.fixture
def store() -> Store:
    store = Store.open(":memory:")
    yield store
    store.close()


@pytest.fixture
def fake_state() -> FakeCalleState:
    return FakeCalleState()


@pytest.fixture
def fake_client(fake_state: FakeCalleState) -> FakeCalleClient:
    return FakeCalleClient(fake_state)


def build(store: Store, env: dict[str, str], client) -> Orchestrator:
    orchestrator = Orchestrator(store=store, config=Config.from_env(env), client=client)
    report = orchestrator.import_data()
    assert report.ok, report.fatal
    return orchestrator


@pytest.fixture
def dry(store, env, fake_client) -> Orchestrator:
    """Dry run: guards refuse before any transport is reached."""
    return build(store, env, fake_client)


@pytest.fixture
def live(store, live_env, fake_client) -> Orchestrator:
    """Live mode against the fake transport. Still no network."""
    return build(store, live_env, fake_client)
