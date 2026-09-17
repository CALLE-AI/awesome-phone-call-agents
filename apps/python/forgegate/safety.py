"""Safety boundaries for ForgeGate: ASCII E.164 destination validation,
operator authorization checks, and redaction/masking for logs, API, and UI.

Adheres to repository-wide safety principles:
- ASCII-only E.164: no transliteration of confusable/unicode digits.
- Authorized destinations only: live dispatches must be operator-authorized.
- Fail-closed masking: phones, credentials, and sensitive provider error
  traces are masked before leaving the process.
"""
from __future__ import annotations

import os
import re
from typing import Optional

# ITU-T E.164: '+' followed by a non-zero country code digit (1-9) and 7-14 more digits.
# Uses `[0-9]` instead of `\d` to strictly reject non-ASCII unicode digits.
E164_PATTERN = re.compile(r"^\+[1-9][0-9]{7,14}$")
DIALABLE_PATTERN = re.compile(r"\+[1-9][0-9]{7,14}")

# Non-phone tokens that must survive display masking untouched:
# ISO datetimes, dates, times, IPv4 addresses + optional port, incident IDs, decimals (temperatures, metrics)
_PROTECT_PATTERN = re.compile(
    r"""
    \d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?  # ISO datetime
  | \d{4}-\d{2}-\d{2}                                                              # Date
  | \b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\b                                # Clock time
  | \b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b                                 # IPv4 + optional port
  | \bINC-\d+\b                                                                     # Incident ID
  | (?<![\d.])\d{1,4}\.\d{1,3}(?![\d.])                                            # Decimals (e.g. 52.3, 0.88)
    """,
    re.X | re.I,
)

# Loose candidate matcher for phone numbers in free text:
# International (+ prefixed), NANP grouped/national, UK/EU 0-prefixed, separated digit runs
_PHONE_LIKE_PATTERN = re.compile(
    r"""
    (?<![\w@.])
    (?:
        (?:\+[1-9][\d\s().-]{6,20}\d)
      | (?:\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})
      | (?:\b0[1-9][\d\s.-]{7,14}\d\b)
      | (?:\+[1-9][0-9]{7,14})
    )
    (?![\w])
    """,
    re.X,
)

ALLOWLIST_ENV = "FORGEGATE_ALLOWED_DESTINATIONS"
FALLBACK_ALLOWLIST_ENV = "CALLE_ALLOWED_DESTINATIONS"


class DestinationError(ValueError):
    """Raised when a destination is malformed, non-ASCII, or not operator-authorized."""


def normalize_ascii_e164(raw: str) -> str:
    """Validate and return `raw` as a strict ASCII E.164 phone number.

    Rejects non-ASCII digits (e.g. Arabic-Indic, fullwidth) rather than
    transliterating, because a confusable digit is a different destination.
    Rejects spaces, dashes, parentheses, or a leading '+0'.
    """
    if not isinstance(raw, str):
        raise DestinationError("Phone number must be a string.")

    value = raw.strip()
    if not value:
        raise DestinationError("Phone number is empty.")

    if not value.isascii():
        offenders = sorted({c for c in value if not c.isascii()})
        raise DestinationError(
            f"Phone number must be ASCII E.164. Refusing non-ASCII character(s): {offenders!r}. "
            "A confusable digit is a different destination."
        )

    if not E164_PATTERN.fullmatch(value):
        raise DestinationError(
            f"Phone number {mask_phone(value)!r} is not valid ASCII E.164. "
            "Expected leading '+', country code 1-9, and 8-15 digits total with no spaces or separators."
        )

    return value


def get_authorized_allowlist() -> list[str]:
    """Returns normalized allowlist from environment variables."""
    raw = os.environ.get(ALLOWLIST_ENV) or os.environ.get(FALLBACK_ALLOWLIST_ENV, "")
    entries = [item.strip() for item in raw.split(",") if item.strip()]
    normalized = []
    for entry in entries:
        try:
            normalized.append(normalize_ascii_e164(entry))
        except DestinationError:
            continue
    return normalized


def assert_authorized_destination(
    phone: str,
    configured_phone: Optional[str] = None,
    allowed_list: Optional[list[str]] = None,
) -> str:
    """Validate destination phone and ensure the operator explicitly authorized it.

    Authorized numbers include:
    1. The configured operator recipient (`CALLE_RECIPIENT_PHONE`).
    2. Any entry in `FORGEGATE_ALLOWED_DESTINATIONS` / `CALLE_ALLOWED_DESTINATIONS`.
    """
    normalized = normalize_ascii_e164(phone)

    authorized: set[str] = set()
    if configured_phone:
        try:
            authorized.add(normalize_ascii_e164(configured_phone))
        except DestinationError:
            pass

    if allowed_list is not None:
        for a in allowed_list:
            try:
                authorized.add(normalize_ascii_e164(a))
            except DestinationError:
                pass
    else:
        authorized.update(get_authorized_allowlist())

    if not authorized:
        raise DestinationError(
            f"No destinations are authorized; refusing to dial {mask_phone(normalized)}. "
            "Set CALLE_RECIPIENT_PHONE or FORGEGATE_ALLOWED_DESTINATIONS with your authorized E.164 number."
        )

    if normalized not in authorized:
        raise DestinationError(
            f"Destination {mask_phone(normalized)} is not in the operator's authorized destination list."
        )

    return normalized


def mask_phone(phone: str) -> str:
    """Mask subscriber digits, keeping country prefix and last 3-4 digits.

    `+15555550142` -> `+1******0142`.
    `+1 (555) 555-0142` -> `+1 (***) ***-0142`.
    `(555) 555-0142` -> `(***) ***-0142`.
    `555-555-0142` -> `***-***-0142`.
    Safe to call on unvalidated, national, or grouped inputs.
    """
    if not isinstance(phone, str):
        return "<invalid>"
    val = phone.strip()
    if not val:
        return "<empty>"

    digits = [i for i, c in enumerate(val) if c.isdigit() or not c.isascii()]
    if len(digits) <= 5:
        return val[0] + "*" * (len(val) - 1) if len(val) > 1 else "*"

    if val.startswith("+"):
        keep_head = digits[:1]
    elif len(digits) == 11 and val[digits[0]] == "1":
        keep_head = digits[:1]
    elif len(digits) in (10, 11) and val[digits[0]] == "0":
        keep_head = digits[:1]
    else:
        keep_head = []

    keep_tail = digits[-4:]
    out = []
    for i, c in enumerate(val):
        if i in digits and i not in keep_head and i not in keep_tail:
            out.append("*")
        else:
            out.append(c)
    return "".join(out)


def mask_text(text: str) -> str:
    """Mask phone numbers, bearer credentials, and API tokens in free text.

    Applied across logging, audit records, API responses, and UI view models.
    Protects timestamps, dates, IP addresses, incident IDs, and metrics before masking.
    """
    if not text:
        return ""

    raw_str = str(text)

    # 1. Protect non-phone tokens (timestamps, IPs, metrics, incident IDs)
    kept: list[str] = []

    def _protect(m: re.Match) -> str:
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    guarded = _PROTECT_PATTERN.sub(_protect, raw_str)

    # 2. Mask candidate phone numbers (E.164, grouped, national, international)
    def _mask_candidate(m: re.Match) -> str:
        candidate = m.group(0)
        digit_count = sum(1 for c in candidate if c.isdigit() or not c.isascii())
        if 7 <= digit_count <= 15:
            return mask_phone(candidate)
        return candidate

    sanitized = _PHONE_LIKE_PATTERN.sub(_mask_candidate, guarded)

    # 3. Mask Bearer tokens
    sanitized = re.sub(
        r"(Bearer\s+)[A-Za-z0-9_\-\.]{8,}",
        r"\1[REDACTED_TOKEN]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # 4. Mask generic API keys
    sanitized = re.sub(
        r"((?:calle|api|secret|token)[_-]?(?:key)?[\"'\s:=]+)[A-Za-z0-9_\-\.]{8,}",
        r"\1[REDACTED_KEY]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # 5. Restore protected tokens
    sanitized = re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], sanitized)

    return sanitized
