"""FastAPI result viewer. Mock mode boots with no credentials (QA contract)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from starlette.responses import Response

from hivemind_closer import __version__
from hivemind_closer.logging import configure_logging, get_logger
from hivemind_closer.settings import Settings, load_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory (uvicorn `--factory` entrypoint)."""
    resolved = settings if settings is not None else load_settings()
    configure_logging(resolved.log_level)
    logger = get_logger("hivemind_closer.api")

    app = FastAPI(title="hivemind-closer", version=__version__)

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.headers.get(
            "X-Request-Id", str(uuid.uuid4())
        )
        return response

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    async def ready() -> dict[str, object]:
        report: dict[str, object] = {
            "mode": "live" if resolved.is_live else "mock",
            "version": __version__,
        }
        if resolved.is_live:
            report["calle_base_url"] = resolved.calle_base_url
        logger.info("readiness_report", mode=report["mode"])
        return report

    return app
