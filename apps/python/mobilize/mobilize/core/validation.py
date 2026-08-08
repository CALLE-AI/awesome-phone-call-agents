"""Shared validation, kept in `core` (not `transports`) so both the
registry loader and the transports can depend on it without creating a
`core -> transports` import direction.
"""

from __future__ import annotations

import re

# Same pattern CALL-E's own OpenAPI spec uses for CallTaskRecipientRequest.phones.
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def validate_e164(phone: str) -> None:
    if not E164_RE.match(phone):
        raise ValueError(f"Phone number is not valid E.164: {phone!r}")
