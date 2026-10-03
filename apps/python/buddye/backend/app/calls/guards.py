"""Two checks that stand between a credential and the outside world, kept in one small module.

`is_strict_e164` decides whether a string may be dialled at all. It is strict on purpose: ASCII
digits only, a leading `+`, no spaces, punctuation, extensions or trailing newline, and no silent
normalisation. A number that needs tidying before it can be compared with the allowlist is a number
whose meaning somebody is guessing at, and the thing on the other end of that guess is a stranger's
phone.

`approved_calle_base_url` decides where the CALL-E API key may be sent. The SDK sends it as a bearer
token to whatever `CALLE_BASE_URL` says, so an `.env` typo or a copied config pointing somewhere else
would hand the key over on the first request. Only the official HTTPS origin is accepted, and the
check runs before a client holding the key is built.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com"
APPROVED_CALLE_ORIGINS: frozenset[str] = frozenset({OFFICIAL_CALLE_ORIGIN})

# `+`, a non-zero country digit, then 1-14 more ASCII digits: 2-15 digits in all. `[0-9]` rather than
# `\d` so full-width and other Unicode digits never match, and fullmatch so a trailing "\n" does not.
_E164 = re.compile(r"\+[1-9][0-9]{1,14}")


class UnapprovedBaseUrl(ValueError):
    pass


def is_strict_e164(phone: object) -> bool:
    return isinstance(phone, str) and _E164.fullmatch(phone) is not None


def approved_calle_base_url(raw: str | None) -> str:
    """The origin the API key may be sent to, or `UnapprovedBaseUrl`. Never echoes a credential."""
    value = (raw or "").strip() or OFFICIAL_CALLE_ORIGIN
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise UnapprovedBaseUrl("CALLE_BASE_URL is not a valid URL") from exc
    if parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise UnapprovedBaseUrl("CALLE_BASE_URL must be a bare origin with no credentials, path, query or fragment")
    host = (parts.hostname or "").lower()
    origin = f"{parts.scheme.lower()}://{host}" + (f":{port}" if port not in (None, 443) else "")
    if parts.scheme.lower() != "https" or origin not in APPROVED_CALLE_ORIGINS:
        raise UnapprovedBaseUrl(
            f"CALLE_BASE_URL must be {OFFICIAL_CALLE_ORIGIN}; refusing to send the CALL-E API key anywhere else"
        )
    return origin
