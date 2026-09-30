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
import secrets
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


#: Generated once per process when no console token is configured, so the
#: documented fixture demo still runs without shipping an anonymous console.
#: The same model Jupyter uses: the server prints it, the operator pastes it.
_EPHEMERAL = secrets.token_urlsafe(24)


def console_token() -> str:
    """The token every console route requires.

    Configured value when there is one, otherwise a per-process random token
    that :func:`startup_banner` prints. Never empty, so the console is never
    anonymous, and never a fixed default, so it cannot ship as a known secret.
    """
    return os.getenv("CRC_CONSOLE_TOKEN") or _EPHEMERAL


def console_token_is_ephemeral() -> bool:
    return not os.getenv("CRC_CONSOLE_TOKEN")


def demo_mode() -> bool:
    """Whether this deployment is a published, fixtures-only demo.

    A public demo has a problem the operator case does not: the visitor cannot
    read the server's stdout, so an ephemeral token locks everyone out and the
    hosted link is dead. Demo mode lets such a deployment publish its own token
    through the unauthenticated ping route.

    It is opt-in and it is narrow. ``CRC_DEMO=true`` alone does nothing: the
    token must also be set explicitly, so a deployment can never publish the
    random per-process token, and live fetch must be off, so demo mode cannot
    be turned on over a deployment holding somebody's real calls. Both
    conditions are re-read on every call rather than cached, so an environment
    that changes cannot leave a stale answer behind.
    """
    return (
        os.getenv("CRC_DEMO", "").strip().lower() in ("1", "true", "yes")
        and bool(os.getenv("CRC_CONSOLE_TOKEN"))
        and not os.getenv("CALLE_API_KEY")
    )


def webhook_token() -> str:
    """The webhook token. Empty means the receiver must refuse.

    Unlike the console there is no useful ephemeral fallback: the sender has to
    be configured with the value, so an unset token can only mean the endpoint
    is not ready to receive.
    """
    return os.getenv("CRC_WEBHOOK_TOKEN", "")


def startup_banner() -> str:
    """What to print so an operator can reach a console they did not configure."""
    if console_token_is_ephemeral():
        return (
            "\n  Call Review Console\n"
            f"  console token for this run: {console_token()}\n"
            "  paste it when the page asks, or send it as X-CRC-Console.\n"
            "  set CRC_CONSOLE_TOKEN to keep a stable one.\n"
        )
    return "\n  Call Review Console: using CRC_CONSOLE_TOKEN from the environment.\n"


def token_matches(presented: str | None, expected: str | None = None) -> bool:
    """Constant-time comparison against the console token, or one supplied."""
    want = console_token() if expected is None else expected
    if not want:
        return False
    return hmac.compare_digest(str(presented or ""), want)
