from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator

import pytest

# Must be set before app.config is imported anywhere.
os.environ.update(
    {
        "CALL_PROVIDER": "mock",
        "STEP_DELAY_S": "0",
        "MOCK_DELAY_S": "0",
        "CALL_BUDGET_MAX": "4",
        "DIALABLE_NUMBERS": "",
        "ANTHROPIC_API_KEY": "",
        "TOKENROUTER_API_KEY": "",  # tests never reach an inference endpoint
        "RECONCILER": "auto",
        "PUBLIC_BASE_URL": "",
        # Keep the suite offline: an unresolvable CLI name means the status preflight never shells out.
        "CALLE_CLI_BIN": "calle-not-installed",
        # Anything a developer's local .env legitimately sets must be neutralised here, or the suite
        # quietly tests that machine instead of this code. A real DEMO_PHONE_B put a routable number
        # on a seeded neighbour and made three unrelated tests fail as though a safety property had
        # broken. These pin the defaults the fixtures are written against.
        "DEMO_PHONE_A": "",
        "DEMO_PHONE_B": "",
        "DEMO_PHONE_C": "",
        "BLOCK_CAPTAIN_NAME": "Alma Reyes",
        "OVERSEER_NAME": "",
        "CALLE_API_KEY": "",
    }
)


@pytest.fixture()
def db(tmp_path, monkeypatch) -> Iterator[None]:  # noqa: ANN001
    from app import config, db as dbmod
    from app.calls import registry

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    config.get_settings.cache_clear()
    dbmod.reset_engine()
    registry.set_provider(None)
    dbmod.init_db()
    yield
    dbmod.reset_engine()
    config.get_settings.cache_clear()
    registry.set_provider(None)


@pytest.fixture()
def seeded(db) -> str:  # noqa: ANN001
    """A seeded block under the heat warning. Returns the hazard id."""
    from app.config import get_settings
    from app.db import session_scope
    from app.seed import seed

    with session_scope() as s:
        hazard = seed(s, get_settings())
        return hazard.id


@pytest.fixture()
def client(db):  # noqa: ANN001, ANN201
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async def _mk():  # noqa: ANN202
        # A loopback peer and a loopback Host, which is what the documented local-only server sees.
        # The API refuses anything else (app/api/local_only.py), so the default "http://test" base URL
        # and the transport's non-loopback default peer would be turned away with a 403.
        return AsyncClient(transport=ASGITransport(app=app, client=("127.0.0.1", 50000)),
                           base_url="http://127.0.0.1:8000")

    return _mk


async def wait_sweeps() -> None:
    """Wait for every in-flight sweep driver. Exceptions are returned, not raised, so a test can
    assert on the FAILED state the runner recorded rather than on a traceback."""
    from app.orchestrator import runner

    tasks = list(runner.active_tasks().values())
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
