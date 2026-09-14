from __future__ import annotations

from datetime import UTC, datetime

import pytest

from fake.calle_server import FakeCalleServer, FakeScenario
from ringdown.calle import McpClient, RestClient
from ringdown.incident import Incident, load_incident, load_rotation
from tests.data import EXAMPLES, an_incident


@pytest.fixture
def incident() -> Incident:
    return an_incident()


@pytest.fixture
def example_incident() -> Incident:
    return load_incident(EXAMPLES / "incident.example.json")


@pytest.fixture
def example_shifts():
    return load_rotation(EXAMPLES / "rotation.example.json")


@pytest.fixture
def now() -> datetime:
    return datetime(2026, 8, 9, 4, 13, tzinfo=UTC)


@pytest.fixture
def serving():
    running: list[FakeCalleServer] = []

    def start(by_phone: dict[str, FakeScenario]) -> FakeCalleServer:
        server = FakeCalleServer(by_phone)
        running.append(server.__enter__())
        return server

    yield start
    for server in running:
        server.__exit__()


@pytest.fixture
def rest_client():
    return lambda server: RestClient(server.base_url, "rd_test_key", timeout=5)


@pytest.fixture
def mcp_client():
    return lambda server: McpClient(server.mcp_url, "rd_test_key", timeout=5)
