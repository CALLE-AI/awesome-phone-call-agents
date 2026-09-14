"""E.164 handling and masking.

Phone numbers are the most sensitive field in this app. They are validated once
on load and masked everywhere else: previews, logs, reports, and errors.
"""

from __future__ import annotations

import re

E164 = re.compile(r"^\+[1-9]\d{6,14}$")

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
    """Strip formatting and return a validated E.164 string."""
    if not isinstance(raw, str):
        raise InvalidPhone("phone must be a string")
    cleaned = re.sub(r"[\s\-().]", "", raw.strip())
    if not E164.match(cleaned):
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


def region_of(phone: str) -> str | None:
    for prefix, region in _PREFIX_REGION:
        if phone.startswith(prefix):
            return region
    return None
