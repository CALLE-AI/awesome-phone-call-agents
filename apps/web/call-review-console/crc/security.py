"""Input and egress guards.

Three things this console must not do, each of which it did before this module
existed:

* build a filesystem path out of an id that arrived in a request body,
* send a bearer credential to whatever host an environment variable names,
* serve any of a caller's transcripts to an unauthenticated request.

Call ids come from CALL-E, from webhook deliveries, and from the URL, and the
last two are attacker-controlled. Everything here is deliberately allow-list
shaped: state what is permitted and refuse the rest, rather than trying to
enumerate what an attacker might send.
"""
from __future__ import annotations

import hmac
import os
import re
from urllib.parse import urlparse

# CALL-E call ids are opaque tokens. Allowing only these characters keeps an id
# from ever containing a path separator, a parent-directory hop, a NUL, or a
# quote that could break out of a JS string literal in the front end.
CALL_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

#: Hosts the CALL-E API key may be sent to. Override only for a private
#: deployment, and only over https -- see :func:`check_api_origin`.
DEFAULT_API_HOSTS = ("api.heycall-e.com",)


class UnsafeCallId(ValueError):
    """A call id that must never reach the filesystem or the browser."""


class UnsafeOrigin(ValueError):
    """A base URL the API key must not be sent to."""


def safe_call_id(call_id: str) -> str:
    """Return ``call_id`` if it is a plain opaque token, else raise.

    Rejects ``../`` traversal, absolute paths, NULs, and the quote characters
    that let an id escape a JS string literal. A leading dot is refused too, so
    an id can never become a dotfile or ``.`` / ``..`` itself.
    """
    cid = "" if call_id is None else str(call_id)
    if not CALL_ID.match(cid) or cid.startswith("."):
        raise UnsafeCallId(f"unacceptable call id: {cid[:64]!r}")
    return cid


def api_hosts() -> tuple[str, ...]:
    """Allowed API hosts, from ``CALLE_ALLOWED_HOSTS`` (comma separated)."""
    raw = os.getenv("CALLE_ALLOWED_HOSTS", "")
    hosts = tuple(h.strip().lower() for h in raw.split(",") if h.strip())
    return hosts or DEFAULT_API_HOSTS


def check_api_origin(base_url: str) -> str:
    """Return ``base_url`` if the API key may be sent there, else raise.

    Requires https and an allow-listed host, so a mistyped or tampered
    ``CALLE_BASE_URL`` cannot exfiltrate the key over plaintext or to a
    third-party host.
    """
    u = urlparse(base_url or "")
    if u.scheme != "https":
        raise UnsafeOrigin(f"CALLE_BASE_URL must be https, got {u.scheme or 'no scheme'!r}")
    host = (u.hostname or "").lower()
    if host not in api_hosts():
        raise UnsafeOrigin(
            f"refusing to send the API key to {host!r}; "
            f"allowed: {', '.join(api_hosts())} (set CALLE_ALLOWED_HOSTS to change)"
        )
    return base_url


def console_token() -> str:
    """The shared token every console route requires, or '' when unset."""
    return os.getenv("CRC_CONSOLE_TOKEN", "")


def token_matches(presented: str | None) -> bool:
    """Constant-time comparison against the configured console token."""
    expected = console_token()
    if not expected:
        return False
    return hmac.compare_digest(str(presented or ""), expected)
