"""Where credentials are allowed to go.

The API key is only ever sent to an approved HTTPS origin. An environment
variable can select among approved origins; it cannot introduce a new one.
Running against a private CALL-E proxy means editing this list in code, where
the change is reviewed.
"""

from __future__ import annotations

from urllib.parse import urlsplit

APPROVED_API_ORIGINS: tuple[str, ...] = ("https://api.heycall-e.com",)


class OriginError(ValueError):
    pass


def approved_base_url(raw: str | None) -> str:
    """Return the approved origin for `raw`, or raise OriginError.

    Accepts only an exact approved origin (scheme + host, optional trailing
    slash, no port, no path, no credentials). None selects the default.
    """
    if raw is None or not raw.strip():
        return APPROVED_API_ORIGINS[0]
    parts = urlsplit(raw.strip())
    if parts.scheme != "https" or parts.username or parts.password or parts.port:
        raise OriginError(f"CALLE_BASE_URL must be one of {', '.join(APPROVED_API_ORIGINS)}")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise OriginError(f"CALLE_BASE_URL must be one of {', '.join(APPROVED_API_ORIGINS)}")
    origin = f"https://{parts.hostname.lower()}" if parts.hostname else ""
    if origin not in APPROVED_API_ORIGINS:
        raise OriginError(f"CALLE_BASE_URL must be one of {', '.join(APPROVED_API_ORIGINS)}")
    return origin
