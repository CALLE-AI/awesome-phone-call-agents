"""The office dashboard.

Loopback-bound, dry-run by default. Phase 0 stub: the mode banner and a health
endpoint, so the credential allowlist is exercised at application startup before
any route exists.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from ..config import Config

TEMPLATES = Path(__file__).parent / "templates"
STATIC = Path(__file__).parent / "static"


def create_app(config: Config | None = None) -> FastAPI:
    """Build the application.

    ``Config.from_env()`` enforces the credential origin allowlist, so a
    misconfigured ``REACHABLE_CALLE_BASE_URL`` raises here rather than at the
    moment somebody tries to place a real call.
    """
    config = config or Config.from_env()
    app = FastAPI(title="Reachable", docs_url=None, redoc_url=None)
    app.state.config = config

    @app.get("/healthz")
    def healthz() -> dict[str, object]:
        return {"ok": True, "mode": config.mode_banner}

    return app
