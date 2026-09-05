"""Deciding whether a number may be dialled, and how it appears in output.

A confirmation sweep dials whatever the order book says, so the order book is
an injection surface: a malformed or unauthorised number is a call placed to
somebody who never asked for one. Every destination passes through here
first, and nothing outside this module prints a number in full.
"""
from __future__ import annotations

import os
import re

# E.164: a plus, a country code that cannot start with zero, up to fifteen
# digits in total. Deliberately ASCII-only: a digit that renders like a seven
# but is not U+0037 has no business reaching a dialler.
E164 = re.compile(r"^\+[1-9]\d{7,14}$")


class UnsafeNumber(ValueError):
    """The destination is malformed, or not one this run may call."""


def normalise(raw: str) -> str:
    """Strip the punctuation people write numbers with, and nothing else.

    Spaces, hyphens, brackets and dots are formatting. Anything else that is
    not a digit or the leading plus is rejected rather than quietly removed,
    because silently deleting a character changes the destination.
    """
    if not isinstance(raw, str):
        raise UnsafeNumber("A phone number must be a string.")

    stripped = raw.strip()
    if not stripped.isascii():
        raise UnsafeNumber(f"Phone number is not ASCII: {mask(stripped)}")

    cleaned = re.sub(r"[ ()\-.]", "", stripped)
    if not E164.match(cleaned):
        raise UnsafeNumber(
            f"Phone number is not E.164 (+ and 8 to 15 digits): {mask(stripped)}"
        )
    return cleaned


def mask(number: str) -> str:
    """How a number is allowed to appear in a log, an error or a note.

    Enough to recognise which line it is, not enough to redial from.
    """
    digits = re.sub(r"\D", "", number or "")
    if len(digits) < 7:
        return "+" + "*" * len(digits)
    return f"+{digits[:3]}{'*' * (len(digits) - 6)}{digits[-3:]}"


def allowlist() -> set[str]:
    """Numbers this run may dial, from CALL_ALLOWLIST.

    Empty means no restriction, which is what a real shop wants: it dials its
    own customers. Set it while testing so a stray order in the book cannot
    put a call through to a stranger.
    """
    raw = os.environ.get("CALL_ALLOWLIST", "")
    return {normalise(part) for part in raw.split(",") if part.strip()}


def authorise(raw: str) -> str:
    """Return the number to dial, or refuse and say why.

    The only way a destination reaches the dialler.
    """
    number = normalise(raw)
    permitted = allowlist()
    if permitted and number not in permitted:
        raise UnsafeNumber(
            f"{mask(number)} is not in CALL_ALLOWLIST, so this run will not dial it."
        )
    return number
