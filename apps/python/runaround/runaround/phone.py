"""E.164 handling: validation, identity, and masking.

Two phone strings that differ only in punctuation are the same desk. Chain
cycle detection depends on that being decided in exactly one place.
"""

from __future__ import annotations

import re

E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

_PUNCTUATION_RE = re.compile(r"[\s()\-.]")


class InvalidPhoneNumber(ValueError):
    """Raised when a phone number is not usable as a call destination."""


def normalize(raw: str) -> str:
    """Return the canonical E.164 form of ``raw``.

    Punctuation humans read aloud is removed. Anything that is still not
    E.164 is refused rather than repaired, because a repaired number is a
    guess about who answers.
    """
    if not isinstance(raw, str):
        raise InvalidPhoneNumber("phone number must be a string")
    candidate = _PUNCTUATION_RE.sub("", raw.strip())
    if not E164_RE.match(candidate):
        raise InvalidPhoneNumber(
            "phone number must be E.164, for example +15550100"
        )
    return candidate


def is_valid(raw: object) -> bool:
    """Return True when ``raw`` normalizes to a usable E.164 number."""
    if not isinstance(raw, str):
        return False
    try:
        normalize(raw)
    except InvalidPhoneNumber:
        return False
    return True


def identity(raw: str) -> str:
    """Return the desk identity used for visited-set and cycle checks."""
    return normalize(raw)


def mask(raw: str) -> str:
    """Return a display form that keeps the country prefix and last two digits.

    Summaries, previews, ledgers, and evidence packs print this form. The full
    number stays in the call request and nowhere else.
    """
    try:
        number = normalize(raw)
    except InvalidPhoneNumber:
        return "[invalid-number]"
    head = number[:2]
    tail = number[-2:]
    hidden = len(number) - len(head) - len(tail)
    return f"{head}{'*' * hidden}{tail}"
