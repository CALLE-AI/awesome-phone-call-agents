"""Shared safety primitives for ringfence: E.164 validation, masking,
redaction.

Adapted from apps/python/calltruth's safety.py (same repo, same author) —
kept as a self-contained copy, not a cross-directory import, per this repo's
own contribution rule that each `apps/*` entry stays self-contained.
Reduced to what ringfence actually needs: fraud-case data (account numbers,
transaction amounts, phone numbers) is more sensitive than a generic contact
list, so every phone/account value that reaches a log or report goes through
this module first.
"""

from __future__ import annotations

import re

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


class InvalidPhoneNumber(ValueError):
    pass


def normalize_e164(raw: str) -> str:
    """Normalize a phone number to E.164, or raise.

    A number with no country code is rejected outright, never guessed — the
    same local digits are a valid subscriber number in more than one
    country, and guessing wrong reaches a stranger.
    """
    if raw is None:
        raise InvalidPhoneNumber("phone number is missing")
    cleaned = re.sub(r"[\s().-]", "", raw.strip())
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        raise InvalidPhoneNumber(
            f"{raw!r} has no country code; refusing to guess one"
        )
    if not _E164_RE.match(cleaned):
        raise InvalidPhoneNumber(f"{raw!r} is not a valid E.164 number")
    return cleaned


def mask_phone(phone: str) -> str:
    """Mask a phone number for display, hiding at least half its digits."""
    if not phone:
        return phone
    digits = [c for c in phone if c.isdigit()]
    if len(digits) < 4:
        return "*" * len(phone)
    visible = max(2, len(digits) // 4)
    masked_digit_count = len(digits) - visible
    out = []
    seen_digits = 0
    for ch in phone:
        if ch.isdigit():
            if seen_digits < masked_digit_count:
                out.append("*")
            else:
                out.append(ch)
            seen_digits += 1
        else:
            out.append(ch)
    return "".join(out)


def mask_account_number(account_number: str) -> str:
    """Mask an account number, keeping only the last 4 characters visible —
    the same convention banks themselves use on statements and receipts."""
    if not account_number:
        return account_number
    if len(account_number) <= 4:
        return "*" * len(account_number)
    return "*" * (len(account_number) - 4) + account_number[-4:]


_REDACT_PATTERNS = (
    re.compile(r"\+\d{7,15}"),  # E.164-shaped numbers
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),  # emails
    re.compile(r"\b\d{6,}\b"),  # long digit runs (accounts, cards, OTPs)
)


def redact_text(text: str) -> str:
    if not text:
        return text
    out = text
    for pattern in _REDACT_PATTERNS:
        out = pattern.sub("[redacted]", out)
    return out


def redact_value(value):
    """Recursively redact strings inside dicts/lists, for stored results."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {k: redact_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_value(v) for v in value]
    return value
