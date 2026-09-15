"""Redaction for anything that leaves the process.

Provider error messages quote the number they were asked to dial, and call
evidence is transcribed speech that can contain a number somebody read aloud.
Both reach a terminal, a log or an HTTP response, so both are masked here
rather than at each call site, where one omission is a disclosure.
"""

from __future__ import annotations

import re

#: Seven or more digits, however the speaker or the provider punctuated them.
_DIALABLE = re.compile(r"\+?\d(?:[\d\s().\-]{5,}\d)")


def mask_number(digits: str) -> str:
    """Keep enough to recognise a line, not enough to ring it."""
    return f"{digits[:2]}{'*' * 6}{digits[-3:]}"


def redact(text: str) -> str:
    """Mask anything in `text` that could be dialled."""
    if not text:
        return text

    def _mask(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        if len(digits) < 7:
            return match.group(0)
        return mask_number(digits)

    return _DIALABLE.sub(_mask, text)


def redact_all(values) -> tuple[str, ...]:
    return tuple(redact(str(value)) for value in values)
