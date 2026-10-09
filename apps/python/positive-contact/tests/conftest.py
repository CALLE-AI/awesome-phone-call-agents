"""Shared fixtures.

An autouse fixture makes `socket.socket` raise for the whole session. If any test ever
reaches the network, it fails loudly instead of quietly costing money.
"""

from __future__ import annotations

import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from positive_contact.ledger import Ledger
from positive_contact.preflight import load_event, load_roster_rows, run_preflight

APP_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = APP_ROOT / "fixtures"
EVENT_PATH = FIXTURES / "event.psps-demo.json"
ROSTER_PATH = FIXTURES / "roster.demo.csv"
EDGE_ROSTER_PATH = FIXTURES / "roster.edge-cases.csv"
SCENARIOS = FIXTURES / "scenarios"
RECORDED = FIXTURES / "recorded"


class NetworkUsedInTest(RuntimeError):
    pass


@pytest.fixture(autouse=True, scope="session")
def _no_outbound_connections():
    """Fail any test that tries to reach the network.

    Outbound connection attempts are blocked rather than socket construction itself,
    because the ASGI test client's event loop legitimately builds a local socket pair.
    Every route to a remote host runs through one of these three calls.
    """
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_create_connection = socket.create_connection

    def blocked(*args, **kwargs):
        raise NetworkUsedInTest(
            "a test tried to open a network connection; PositiveContact tests run "
            "entirely offline against the fixture and replay transports"
        )

    socket.socket.connect = blocked  # type: ignore[assignment]
    socket.socket.connect_ex = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        yield
    finally:
        socket.socket.connect = real_connect  # type: ignore[assignment]
        socket.socket.connect_ex = real_connect_ex  # type: ignore[assignment]
        socket.create_connection = real_create_connection  # type: ignore[assignment]


@pytest.fixture
def event_and_policy():
    return load_event(EVENT_PATH)


@pytest.fixture
def event(event_and_policy):
    return event_and_policy[0]


@pytest.fixture
def policy(event_and_policy):
    return event_and_policy[1]


@pytest.fixture
def now(event):
    """A clock four hours before the field-visit cutoff, outside quiet hours."""
    return event.field_visit_cutoff - timedelta(hours=4)


@pytest.fixture
def ledger(tmp_path):
    """A file-backed ledger.

    Deliberately not `:memory:`. The dashboard opens the ledger by path, so an in-memory
    database would hand it a second, empty one and every "the page does not leak" check
    would pass against a blank page.
    """
    store = Ledger(tmp_path / "ledger.db")
    try:
        yield store
    finally:
        store.close()


@pytest.fixture
def demo_preflight(event, policy, now):
    return run_preflight(event, policy, load_roster_rows(ROSTER_PATH), now=now)


@pytest.fixture
def edge_preflight(event, policy, now):
    return run_preflight(event, policy, load_roster_rows(EDGE_ROSTER_PATH), now=now)


@pytest.fixture
def fixture_transport():
    from positive_contact.transports.fixture import FixtureTransport

    return FixtureTransport(SCENARIOS)


def utc(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
