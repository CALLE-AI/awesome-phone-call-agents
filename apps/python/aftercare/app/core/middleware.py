from __future__ import annotations

import uuid

from app.config import settings
from app.core.logging import request_id_ctx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    header_name = "X-Request-ID"

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = request.headers.get(self.header_name)
        request_id = (incoming or "").strip() or uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
            response.headers[self.header_name] = request_id
            return response
        finally:
            request_id_ctx.reset(token)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    _csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    _api_prefixes = (
        "/auth",
        "/dashboard",
        "/agent",
        "/patients",
        "/calls",
        "/webhooks",
        "/followups",
        "/protocols",
        "/health",
        "/openapi.json",
    )
    _ui_csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "media-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )

    @classmethod
    def _is_api_path(cls, path: str) -> bool:
        return path == "/openapi.json" or path.startswith(cls._api_prefixes)

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        if request.url.path in {"/docs", "/redoc"}:
            csp = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' https://fastapi.tiangolo.com data:; "
                "connect-src 'self'; "
                "frame-ancestors 'none'; base-uri 'none'"
            )
        elif self._is_api_path(request.url.path):
            csp = self._csp
        else:
            csp = self._ui_csp
        response.headers.setdefault("Content-Security-Policy", csp)
        if settings.force_https_enabled:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response
