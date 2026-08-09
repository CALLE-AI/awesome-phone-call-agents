"""Conservative phone normalization for the selection boundary."""

from __future__ import annotations

import re


E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone(value: str) -> str | None:
    """Normalize common punctuation without guessing a country code."""

    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if cleaned.startswith("+"):
        cleaned = "+" + re.sub(r"[^0-9]", "", cleaned[1:])
    else:
        cleaned = re.sub(r"[^0-9]", "", cleaned)
    return cleaned if E164_PATTERN.fullmatch(cleaned) else None


def mask_phone(value: str) -> str:
    """Mask an already normalized phone number for local reports and logs."""

    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}{'*' * (len(value) - 6)}{value[-3:]}"
