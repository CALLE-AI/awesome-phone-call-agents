"""E.164 normalization, dial authorization, and masking.

Nothing is dialed that has not passed through ``assert_authorized``.
"""
from __future__ import annotations

import os
import re

ALLOWLIST_ENV = "NOSHOWZERO_ALLOWED_DESTINATIONS"

_E164 = re.compile(r"\+[1-9][0-9]{7,14}")
_TYPED_CHARS = re.compile(r"[0-9+\s().-]+")
_PHONE_LIKE = re.compile(r"\+?[0-9][0-9\s().-]{6,}[0-9]")

# Country calling code -> ISO region, sent to CALL-E as a routing and compliance hint.
_REGIONS = {"+1": "US", "+44": "GB", "+61": "AU", "+84": "VN", "+52": "MX", "+34": "ES", "+33": "FR",
            "+49": "DE", "+82": "KR", "+81": "JP", "+65": "SG"}


class DestinationError(ValueError):
    """A phone number that is invalid, ambiguous, or not authorized."""


def mask(phone: str) -> str:
    """'+12125550116' -> '+1******0116'. Never returns a full number."""
    p = (phone or "").strip()
    if len(p) <= 6:
        return "*" * len(p)
    return p[:2] + "*" * (len(p) - 6) + p[-4:]


def mask_all(text: str) -> str:
    """Mask every phone-like digit run inside free text (transcripts, notes, failure messages)."""

    def _sub(m: re.Match) -> str:
        raw = m.group(0)
        digits = re.sub(r"[^0-9]", "", raw)
        if len(digits) < 7:
            return raw
        return mask(("+" if raw.startswith("+") else "") + digits)

    return _PHONE_LIKE.sub(_sub, text or "")


def normalize_e164(raw: str, default_country: str = "1") -> str:
    """Normalize a number from a calendar event or intake form: '(212) 555-0116' -> '+12125550116'.

    Formatting characters are accepted because front desks type numbers that way. Non-ASCII
    digits are refused rather than transliterated: a confusable digit is a different destination.
    """
    s = (raw or "").strip()
    if not s:
        raise DestinationError("phone number is empty")
    if not s.isascii():
        raise DestinationError("phone number contains non-ASCII characters")
    if not _TYPED_CHARS.fullmatch(s) or s.count("+") > 1 or ("+" in s and not s.startswith("+")):
        raise DestinationError(f"{mask(s)} contains characters that are not part of a phone number")
    digits = re.sub(r"[^0-9]", "", s)
    if s.startswith("+"):
        candidate = "+" + digits
    elif len(digits) == 10:
        candidate = f"+{default_country}{digits}"
    elif len(digits) == 11 and digits.startswith(default_country):
        candidate = "+" + digits
    else:
        raise DestinationError(f"cannot read {mask(s)} as an E.164 number")
    if not _E164.fullmatch(candidate):
        raise DestinationError(f"{mask(candidate)} is not a valid E.164 number")
    return candidate


def allowlist(value: str | None = None) -> set[str]:
    """Operator-authorized destinations. Entries must already be strict E.164.

    An unset or empty list authorizes nothing, so a misconfigured deployment places no calls
    rather than every call.
    """
    raw = os.environ.get(ALLOWLIST_ENV, "") if value is None else value
    allowed: set[str] = set()
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if not entry.isascii() or not _E164.fullmatch(entry):
            raise DestinationError(f"{ALLOWLIST_ENV} entry {mask(entry)} is not ASCII E.164")
        allowed.add(entry)
    return allowed


def assert_authorized(phone: str, allowed: set[str] | None = None) -> str:
    """Normalize, then require the number to be on the operator allowlist."""
    normalized = normalize_e164(phone)
    if normalized not in (allowlist() if allowed is None else allowed):
        raise DestinationError(f"{mask(normalized)} is not in {ALLOWLIST_ENV}")
    return normalized


def region_for(phone: str) -> str | None:
    for prefix in sorted(_REGIONS, key=len, reverse=True):
        if phone.startswith(prefix):
            return _REGIONS[prefix]
    return None
