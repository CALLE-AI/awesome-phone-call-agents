"""Strict CALL-E HTTPS origin allowlist — credential exfiltration prevention."""

from __future__ import annotations

from urllib.parse import urlparse

from accessline.calle_contract import BASE_URL_DEFAULT
from accessline.exceptions import CallEUnavailable

# Official production origin from calle_contract.BASE_URL_DEFAULT (repo truth).
APPROVED_CALL_E_ORIGINS = frozenset({BASE_URL_DEFAULT.rstrip("/")})


def approved_call_e_origin() -> str:
    return BASE_URL_DEFAULT.rstrip("/")


def assert_approved_call_e_origin(base_url: str) -> str:
    """Validate origin before any Authorization header is attached.

    HTTPS only. Exact approved origin. No userinfo, no alternate ports,
    no lookalikes, no localhost credential-bearing production transport.
    """
    if base_url is None or not str(base_url).strip():
        raise CallEUnavailable("CALL-E base URL is required")
    raw = str(base_url).strip().rstrip("/")
    parsed = urlparse(raw)
    if parsed.scheme != "https":
        raise CallEUnavailable("CALL-E base URL must use HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise CallEUnavailable("CALL-E base URL must not include userinfo")
    if parsed.path not in ("", "/"):
        raise CallEUnavailable("CALL-E base URL must be origin-only (no path)")
    if parsed.params or parsed.query or parsed.fragment:
        raise CallEUnavailable("CALL-E base URL must not include query/fragment")
    if parsed.port is not None:
        raise CallEUnavailable("CALL-E base URL must not use an alternate port")
    host = (parsed.hostname or "").lower()
    if not host:
        raise CallEUnavailable("CALL-E base URL missing hostname")
    if host in {"localhost", "127.0.0.1", "::1"}:
        raise CallEUnavailable(
            "CALL-E credential-bearing transport rejects localhost origins"
        )
    origin = f"https://{host}"
    if origin not in APPROVED_CALL_E_ORIGINS:
        raise CallEUnavailable(
            "CALL-E base URL is not an approved official origin; "
            "bearer credentials will not be sent"
        )
    return origin
