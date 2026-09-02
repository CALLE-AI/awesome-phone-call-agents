"""E.164 validation and masking. Never log a full phone number."""

from __future__ import annotations

import re

# E.164: + then 1-9, then 7-14 more digits (8-15 digits total after +).
# Rejects +0 prefixes used in some test fakes that are not dialable.
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")


def validate_e164(phone: str) -> str:
    if not isinstance(phone, str) or not phone.strip():
        raise ValueError("phone is required and must be an E.164 string")
    value = phone.strip()
    if not E164_RE.fullmatch(value):
        raise ValueError(
            "phone must be E.164 (+ then 8-15 digits, no leading 0 after +), "
            "for example +447700900123"
        )
    return value


def mask_phone(phone: str) -> str:
    """Keep country-ish prefix and last 4 digits. Safe for stdout and fixtures."""
    value = phone.strip()
    if len(value) < 8:
        return "****"
    return value[:3] + ("*" * (len(value) - 7)) + value[-4:]
