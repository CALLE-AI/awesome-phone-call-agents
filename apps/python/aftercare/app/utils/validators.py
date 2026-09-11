import hmac
import re
from urllib.parse import urlparse

# ASCII digits only. `\d` also matches non-ASCII numerals.
E164_REGEX = re.compile(r"^\+[1-9][0-9]{7,14}$")
E164_PATTERN = r"^\+[1-9][0-9]{7,14}$"

OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com"
OFFICIAL_CALLE_HOST = "api.heycall-e.com"


class UntrustedCalleOrigin(ValueError):
    """Raised when a CALL-E base URL would send the Bearer key off-origin."""


def validate_official_calle_origin(url: str | None) -> str:
    if url is None or not isinstance(url, str) or not url.strip():
        return OFFICIAL_CALLE_ORIGIN
    parsed = urlparse(url.strip())
    if parsed.scheme.lower() != "https":
        raise UntrustedCalleOrigin(
            f"base_url must use https and be {OFFICIAL_CALLE_ORIGIN}"
        )
    if parsed.username or parsed.password:
        raise UntrustedCalleOrigin("base_url must not contain credentials")
    host = (parsed.hostname or "").lower()
    if host != OFFICIAL_CALLE_HOST:
        raise UntrustedCalleOrigin(
            f"base_url host must be {OFFICIAL_CALLE_HOST}; got {host or parsed.netloc}"
        )
    if parsed.port is not None and parsed.port != 443:
        raise UntrustedCalleOrigin("base_url must not use a custom port")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise UntrustedCalleOrigin(f"base_url must be exactly {OFFICIAL_CALLE_ORIGIN}")
    return OFFICIAL_CALLE_ORIGIN


def is_supported_e164(phone: str) -> bool:
    return (
        isinstance(phone, str)
        and phone.isascii()
        and bool(E164_REGEX.fullmatch(phone))
    )


def is_valid_e164(phone: str) -> bool:
    return is_supported_e164(phone)


def destinations_match(left: str, right: str) -> bool:
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)
