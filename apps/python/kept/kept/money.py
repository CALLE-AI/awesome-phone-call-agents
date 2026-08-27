"""Money as integer minor units. No float ever touches an amount."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

MINOR_UNITS_PER_MAJOR = 100

_CURRENCY_NOISE = re.compile(r"[^0-9.,\-]")
_GROUPED_THOUSANDS = re.compile(r"^-?\d{1,3}(,\d{3})+(\.\d+)?$")


class AmountParseError(ValueError):
    """Raised when spoken or written text cannot be read as an exact amount."""


def parse_amount_to_minor(text: str) -> int:
    """Parse an amount written by a human or transcribed from speech.

    Accepts "1250", "1,250.00", "$1,250.00", "₹ 1250.5". Rejects anything
    ambiguous rather than guessing, because a wrong amount silently becomes a
    wrong financial record.
    """
    if not isinstance(text, str) or not text.strip():
        raise AmountParseError("Amount is empty.")
    cleaned = _CURRENCY_NOISE.sub("", text.strip())
    if not cleaned:
        raise AmountParseError(f"No digits in amount {text!r}.")
    cleaned = _strip_thousands_separators(cleaned)
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise AmountParseError(f"Cannot read {text!r} as an exact amount.") from exc
    if value < 0:
        raise AmountParseError(f"Amount {text!r} is negative.")
    return _to_minor_units(value, text)


def _strip_thousands_separators(cleaned: str) -> str:
    if "," not in cleaned:
        return cleaned
    if _GROUPED_THOUSANDS.match(cleaned):
        return cleaned.replace(",", "")
    raise AmountParseError(f"Ambiguous separators in amount {cleaned!r}.")


def _to_minor_units(value: Decimal, original: str) -> int:
    scaled = value * MINOR_UNITS_PER_MAJOR
    if scaled != scaled.to_integral_value():
        raise AmountParseError(f"Amount {original!r} is finer than one minor unit.")
    return int(scaled)


def format_minor(amount_minor: int, currency: str) -> str:
    major, minor = divmod(abs(amount_minor), MINOR_UNITS_PER_MAJOR)
    sign = "-" if amount_minor < 0 else ""
    return f"{sign}{currency} {major:,}.{minor:02d}"
