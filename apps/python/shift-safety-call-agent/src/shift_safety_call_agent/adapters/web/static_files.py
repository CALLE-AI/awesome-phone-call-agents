"""Safe package-resource routes for the same-origin local Web UI."""

from dataclasses import dataclass
from importlib.resources import files

from fastapi import FastAPI, Response


_WEB_PACKAGE = "shift_safety_call_agent.adapters.web"

_CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    )
)

_SECURITY_HEADERS = {
    "Content-Security-Policy": _CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
}


class StaticAssetUnavailableError(RuntimeError):
    """A required packaged UI asset is unavailable."""


@dataclass(frozen=True, slots=True)
class _StaticAsset:
    filename: str
    media_type: str


_STATIC_ASSETS = {
    "app": _StaticAsset("app.html", "text/html"),
    "css": _StaticAsset("app.css", "text/css"),
    "javascript": _StaticAsset("app.js", "application/javascript"),
}


def _read_static_asset(asset_name: str) -> tuple[bytes, str]:
    asset = _STATIC_ASSETS[asset_name]
    try:
        resource = files(_WEB_PACKAGE).joinpath("static", asset.filename)
        if not resource.is_file():
            raise FileNotFoundError
        return resource.read_bytes(), asset.media_type
    except (FileNotFoundError, OSError, TypeError) as error:
        raise StaticAssetUnavailableError(
            "Required local Web UI assets are unavailable."
        ) from error


def validate_static_assets() -> None:
    """Fail safely during app creation if a required package asset is absent."""

    for asset_name in _STATIC_ASSETS:
        _read_static_asset(asset_name)


def _static_response(asset_name: str) -> Response:
    content, media_type = _read_static_asset(asset_name)
    return Response(
        content=content,
        media_type=media_type,
        headers=_SECURITY_HEADERS,
    )


def install_static_ui_routes(app: FastAPI) -> None:
    """Register only the three fixed UI resources outside OpenAPI."""

    validate_static_assets()

    @app.get("/app", include_in_schema=False)
    def local_web_ui() -> Response:
        return _static_response("app")

    @app.get("/assets/app.css", include_in_schema=False)
    def local_web_styles() -> Response:
        return _static_response("css")

    @app.get("/assets/app.js", include_in_schema=False)
    def local_web_javascript() -> Response:
        return _static_response("javascript")
