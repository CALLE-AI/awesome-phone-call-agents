"""Explicit localhost-only Uvicorn composition for the local API."""

from collections.abc import Callable
from pathlib import Path
from typing import TextIO

import uvicorn

from shift_safety_call_agent.adapters.sqlite_repository import SqliteInterviewRepository
from shift_safety_call_agent.adapters.web.app import create_app
from shift_safety_call_agent.adapters.web.static_files import (
    StaticAssetUnavailableError,
)
from shift_safety_call_agent.application.repository_errors import RepositoryError


LOCAL_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8765


def serve_local_api(
    *,
    repository: SqliteInterviewRepository,
    database_label: str,
    port: int,
    app_version: str,
    output: TextIO,
    runner: Callable[..., None] | None = None,
) -> int:
    """Initialize storage and run one non-reloading localhost worker."""

    try:
        app = create_app(repository=repository, app_version=app_version)
    except StaticAssetUnavailableError:
        print("Local API could not load its packaged UI assets.", file=output)
        return 2

    try:
        repository.initialize()
    except RepositoryError:
        print("Local API could not initialize its database.", file=output)
        return 2

    print(
        "\n".join(
            (
                "LOCAL API",
                f"- Address: http://{LOCAL_API_HOST}:{port}",
                "- Provider: fake",
                f"- Database: {database_label}",
                "- Real calls enabled: false",
                "- External access: disabled",
            )
        ),
        file=output,
    )
    try:
        (runner or uvicorn.run)(
            app,
            host=LOCAL_API_HOST,
            port=port,
            reload=False,
            workers=1,
            access_log=False,
        )
    except (OSError, SystemExit):
        print("Local API could not start; the local port may be unavailable.", file=output)
        return 2
    return 0
