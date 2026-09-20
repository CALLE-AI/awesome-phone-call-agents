"""The API answers this machine only. The CALL-E webhook is the single exemption.

BuddyE's console has no login, and its endpoints do things that must not be reachable from the
internet: they start real calls (`POST /api/hazards/{id}/sweep`, `POST /api/cases/.../call`), release
responder handoffs, authorise agency dispatches, and return private records — named neighbours'
health conditions, addresses and call transcripts. That is fine for one volunteer on their own
laptop and not fine anywhere else, so BuddyE is a local operator tool, and the app enforces that
instead of leaving it to the README.

A request is served only when all of these hold:

* the TCP peer is a loopback address, so `--host 0.0.0.0` exposes nothing to the LAN;
* the Host header names a loopback host, so a hostile page that rebinds its own DNS name to
  127.0.0.1 is still refused;
* no forwarding header is present. A tunnel or reverse proxy running on the same machine connects
  from loopback, but it adds `X-Forwarded-For` / `Forwarded` / `CF-Connecting-IP`, and Vite's dev
  proxy passes those straight through;
* an `Origin` header, when the browser sends one, is a loopback origin, so a page on another site
  cannot drive the API from the operator's own browser.

The exemption is `POST /api/calle/webhook/{token}`. It is the only reason a tunnel would exist, it
returns nothing private, and it has its own defences: a random path token, a header/body event-id
match, deduplication, and a re-fetch from the Calls API before anything is acted on. Nothing else is
exempt, and no setting turns this off.

Pure ASGI rather than `BaseHTTPMiddleware`, so the SSE stream is passed through untouched.
"""
from __future__ import annotations

import re
from ipaddress import ip_address
from urllib.parse import urlsplit

from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

WEBHOOK_PATH = re.compile(r"/api/calle/webhook/[^/]+")
FORWARDING_HEADERS = (
    "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
    "cf-connecting-ip", "true-client-ip", "x-original-forwarded-for",
)


def is_loopback_host(host: str | None) -> bool:
    value = (host or "").strip().strip("[]").lower()
    if value == "localhost":
        return True
    try:
        addr = ip_address(value)
    except ValueError:
        return False
    mapped = getattr(addr, "ipv4_mapped", None)
    return bool(addr.is_loopback or (mapped is not None and mapped.is_loopback))


def refusal(conn: HTTPConnection, method: str = "GET") -> str | None:
    """Why this request may not be served, or None when it may."""
    if method == "POST" and WEBHOOK_PATH.fullmatch(conn.url.path):
        return None
    if conn.client is None or not is_loopback_host(conn.client.host):
        return "BuddyE's API is local-only: connect from this machine"
    if not is_loopback_host(conn.url.hostname):
        return "BuddyE's API is local-only: the Host header must be localhost or a loopback address"
    if any(name in conn.headers for name in FORWARDING_HEADERS):
        return "BuddyE's API is local-only and is not served through a tunnel or proxy (only the CALL-E webhook is)"
    origin = conn.headers.get("origin")
    if origin is not None and not is_loopback_host(urlsplit(origin).hostname):
        return "BuddyE's API is local-only: cross-site browser requests are refused"
    return None


class LocalOnlyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in {"http", "websocket"}:
            reason = refusal(HTTPConnection(scope), str(scope.get("method") or "GET"))
            if reason is not None:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                await JSONResponse(status_code=403, content={"detail": reason})(scope, receive, send)
                return
        await self.app(scope, receive, send)
