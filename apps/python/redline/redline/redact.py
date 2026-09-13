"""Mask phone numbers and credentials before anything is printed or written.

Every path out of REDLINE goes through here: the terminal report, the JSON
export, the HTML report, log lines, and error messages. There is no "internal"
output that skips it. The upstream review record is unambiguous on this point --
an unmasked number in a log, a preview, or even a fake server's output is a
blocking finding, and a report file is the easiest thing in the world to paste
into an issue.

Masking keeps enough of a number to tell two recipients apart and not enough to
dial either.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

__all__ = ["mask_number", "redact", "redact_payload"]

#: E.164 and loosely-formatted international numbers.
_E164 = re.compile(r"\+[1-9]\d{1,3}[\s().-]?\d[\d\s().-]{5,16}\d")

#: Local NANP spellings, which an API can echo back from a transcript.
_NANP_LOCAL = re.compile(r"\b\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\b")

#: Anything credential-shaped that could reach a log through an error payload.
_CREDENTIAL = re.compile(
    r"\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9]{16,}\b"
    r"|\biams_(?:live|test|sk)_[A-Za-z0-9_-]{8,}\b"
    r"|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"
    r"|\bBearer\s+[A-Za-z0-9._-]{16,}\b"
)

#: Keys whose value is always masked wholesale, whatever it looks like.
SENSITIVE_KEYS = frozenset(
    {
        "api_key",
        "apikey",
        "authorization",
        "auth_token",
        "access_token",
        "password",
        "secret",
        "token",
        "phone",
        "phones",
        "to",
        "recipient_phone",
    }
)

MASK = "[redacted]"


def mask_number(number: str) -> str:
    """Mask a phone number, keeping its country prefix and last two digits.

    ``+14155550142`` becomes ``+1********42``. That is enough to tell two
    recipients apart in a report and useless for placing a call.
    """
    compact = number.strip()
    digits = [index for index, ch in enumerate(compact) if ch.isdigit()]
    if len(digits) < 4:
        return MASK

    keep_leading = 2 if compact.startswith("+") else 1
    head = compact[: digits[keep_leading - 1] + 1]
    tail = compact[digits[-2] :]
    return f"{head}{'*' * max(4, len(digits) - keep_leading - 2)}{tail}"


def redact(text: str) -> str:
    """Mask every number and credential in a block of text."""
    if not text:
        return text
    masked = _E164.sub(lambda m: mask_number(m.group(0)), text)
    masked = _NANP_LOCAL.sub(lambda m: mask_number(m.group(0)), masked)
    return _CREDENTIAL.sub(MASK, masked)


def redact_payload(value: Any) -> Any:
    """Recursively mask a JSON-shaped structure.

    Applied to raw CALL-E payloads before they are written to a report, since a
    call task carries the dialled number in several places and a report file is
    the easiest thing to paste into a public issue.
    """
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, Mapping):
        return {
            key: (
                MASK
                if isinstance(key, str) and key.casefold() in SENSITIVE_KEYS
                else redact_payload(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return [redact_payload(item) for item in value]
    return value
