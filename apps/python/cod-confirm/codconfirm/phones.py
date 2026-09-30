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


DIGIT_RUN = re.compile(r"(\+?\d[\d\-. ()]{6,}\d)")

# Anything that can forge a log line, move a cursor, or hide the rest of a
# sentence from whoever reads it later.
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
BARE_DIGITS = re.compile(r"\d{8,}")

MAX_TEXT = 400
"""Longest a scrubbed field may be. A note is read by a person, and an
unbounded one is a way to push the rest of the record off their screen."""


def scrub(text: str, limit: int = MAX_TEXT) -> str:
    """Make free text safe to log, to persist, and for a person to read.

    Everything the platform hands back is somebody's speech passed through a
    model, which means it is untrusted input that ends up in a note a human
    later acts on. Masking phone numbers is not enough on its own, so this
    also removes what could forge or hide a line:

    * terminal escapes and control characters, which can rewrite what a
      reader sees in a console
    * newlines and tabs, so one field cannot pose as several log lines
    * email addresses and long digit runs, because people read card numbers
      and contact details out loud without being asked to
    * anything past `limit`, which is truncated rather than trusted

    Order matters. Control characters come out first, or a number split by
    one would slip past the masks that follow.
    """
    if not text:
        return text

    cleaned = ANSI.sub(" ", str(text))
    cleaned = CONTROL.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    cleaned = EMAIL.sub("<email removed>", cleaned)
    cleaned = DIGIT_RUN.sub(lambda m: mask(m.group(1)), cleaned)
    # Whatever survives with eight or more digits together is a card, an
    # account, or a number written without punctuation. None of it belongs in
    # a note a person reads.
    cleaned = BARE_DIGITS.sub(lambda m: mask(m.group(0)), cleaned)

    if limit and len(cleaned) > limit:
        cleaned = cleaned[:limit].rstrip() + " [truncated]"
    return cleaned


def require_authorisation() -> set[str]:
    """The allowlist this run will dial, or a refusal to start.

    Every live destination is named in advance. There is deliberately no
    setting that means "call whatever the order book says": an order book is
    data, and data can be wrong, stale, or someone else's. Naming the
    destinations is the operator saying which real telephones may ring, and
    a run that cannot say stops before the first one does.
    """
    permitted = allowlist()
    if not permitted:
        raise UnsafeNumber(
            "Live calling needs CALL_ALLOWLIST set to the numbers this run "
            "may dial, as a comma-separated list in E.164 form. There is no "
            "option to dial everything: a destination that was not named "
            "cannot be called."
        )
    return permitted


def allowlist() -> set[str]:
    """Numbers this run may dial, from CALL_ALLOWLIST.

    Empty means nothing may be dialled. A deployment builds this list for
    the sweep it is about to run, from the customers it is entitled to call.
    """
    raw = os.environ.get("CALL_ALLOWLIST", "")
    return {normalise(part) for part in raw.split(",") if part.strip()}


def authorise(raw: str) -> str:
    """Return the number to dial, or refuse and say why.

    The only way a destination reaches the dialler, and it refuses by
    default: a number is dialled because it appears on the allowlist, never
    because nothing objected to it.
    """
    number = normalise(raw)
    permitted = allowlist()
    if not permitted:
        raise UnsafeNumber(
            "CALL_ALLOWLIST is empty, so this run may not dial anything."
        )
    if number not in permitted:
        raise UnsafeNumber(
            f"{mask(number)} is not in CALL_ALLOWLIST, so this run will not dial it."
        )
    return number
