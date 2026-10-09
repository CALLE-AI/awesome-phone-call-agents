"""E.164 handling and masking.

Phone numbers are the most sensitive field in this app. They are validated once
on load and masked everywhere else: previews, logs, reports, and errors.
"""

from __future__ import annotations

import re

# ASCII digits only, full match: no Unicode digit classes, no trailing newline.
E164 = re.compile(r"\+[1-9][0-9]{6,14}", re.ASCII)

# Anything that looks like a dialable number inside free text: an optional +,
# then 7 or more digits allowing spaces, dots, hyphens and parentheses between.
_NUMBER_IN_TEXT = re.compile(r"\+?[0-9](?:[0-9 .\-()]{5,}[0-9])", re.ASCII)
# Calendar dates share the digit count of a local number; leave them readable.
_DATE_SHAPE = re.compile(r"(?:[0-9]{4}[-/.][0-9]{2}[-/.][0-9]{2}|[0-9]{2}[-/.][0-9]{2}[-/.][0-9]{4})", re.ASCII)

# Region prefixes this app knows how to label. CALL-E decides what it will
# actually dial; see preflight.py for the live check.
_PREFIX_REGION = (
    ("+65", "SG"),
    ("+62", "ID"),
    ("+60", "MY"),
    ("+1", "US"),
)


class InvalidPhone(ValueError):
    pass


def normalize(raw: str) -> str:
    """Strip formatting and return a validated E.164 string.

    Normalisation removes ASCII spaces, tabs, hyphens, dots and parentheses.
    Everything else must already be a plus sign followed by 7-15 ASCII digits.
    """
    if not isinstance(raw, str):
        raise InvalidPhone("phone must be a string")
    cleaned = re.sub(r"[ \t\-().]", "", raw.strip(" \t\r\n"), flags=re.ASCII)
    if not E164.fullmatch(cleaned):
        raise InvalidPhone(
            f"phone {mask(cleaned)} is not E.164 (expected +<country><number>)"
        )
    return cleaned


def mask(phone: str) -> str:
    """Render a number safe for logs and summaries: +65*****1234."""
    if not isinstance(phone, str) or len(phone) < 4:
        return "****"
    tail = phone[-4:]
    head = phone[:3] if phone.startswith("+") else ""
    return f"{head}{'*' * max(0, len(phone) - len(head) - 4)}{tail}"


def redact(text: str | None) -> str:
    """Mask every phone-number-like run inside free text.

    Applied to anything a person or a log will see that did not come from the
    roster: provider error messages, summaries, evidence, guardian free text,
    and the preview of the call script. The request sent to CALL-E is never
    redacted.
    """
    if not isinstance(text, str) or not text:
        return "" if text is None else text

    def _sub(m: re.Match[str]) -> str:
        token = m.group(0)
        if _DATE_SHAPE.fullmatch(token.strip()):
            return token
        digits = re.sub(r"[^0-9]", "", token)
        if len(digits) < 7:
            return token
        return mask(("+" if m.group(0).startswith("+") else "") + digits)

    return _NUMBER_IN_TEXT.sub(_sub, text)


def region_of(phone: str) -> str | None:
    for prefix, region in _PREFIX_REGION:
        if phone.startswith(prefix):
            return region
    return None
