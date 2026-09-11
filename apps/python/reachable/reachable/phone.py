"""Strict ASCII E.164 validation, and masking.

Requirement 4 of docs/SAFETY.md. Numbers are **rejected, never repaired**:
no stripping of spaces, no adding a country code, no inferring +44 from a
leading 0. Guessing a destination means guessing whose telephone rings.
"""

from __future__ import annotations

import re

#: The pattern CALL-E itself requires of a recipient phone number, per
#: CallTaskRecipientRequest.phones in OpenAPI 0.7.0.
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")

#: UK numbers reserved by Ofcom for drama and fiction: +447700900000 to
#: +447700900999, which is a fixed prefix plus exactly three digits. No fixture
#: may contain a number outside this range, because a fixture number must never
#: be able to ring a real subscriber.
DRAMA_RE = re.compile(r"^\+447700900[0-9]{3}$")


class InvalidPhoneNumber(ValueError):
    """A destination that will not be dialled. Carries a reason for the office."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _is_ascii(value: str) -> bool:
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return False
    return True


def validate_e164(raw: str | None) -> str:
    """Return the number unchanged, or raise with a human-readable reason.

    ASCII is checked *before* the pattern. Unicode decimal digits such as the
    Arabic-Indic or full-width forms are digits to ``str.isdigit`` and would be
    normalised into ASCII by ``int()`` -- so a number containing them could pass
    a naive check and then dial something the office never typed. They are
    refused outright.
    """
    value = raw if isinstance(raw, str) else ""
    if not value:
        raise InvalidPhoneNumber("missing phone number")
    if not _is_ascii(value):
        raise InvalidPhoneNumber("phone number contains non-ASCII characters")
    if value != value.strip():
        raise InvalidPhoneNumber("phone number has leading or trailing whitespace")
    if not value.startswith("+"):
        raise InvalidPhoneNumber("phone number must start with + and a country code")
    if not E164_RE.match(value):
        raise InvalidPhoneNumber("phone number is not valid E.164")
    return value


def is_e164(raw: str | None) -> bool:
    try:
        validate_e164(raw)
    except InvalidPhoneNumber:
        return False
    return True


def is_drama_number(raw: str | None) -> bool:
    """True for Ofcom's reserved drama range, which can never reach a subscriber."""
    return bool(DRAMA_RE.match((raw or "").strip()))


def mask(raw: str | None) -> str:
    """Render a number for display: the last three digits only.

    Used in the dashboard, logs, audit rows, exports and CLI output -- every
    surface except the single storage column. An unusable value masks to a
    placeholder rather than raising: a masking helper must never be the thing
    that takes the dashboard down.
    """
    value = (raw or "").strip()
    if len(value) < 3:
        return "***"
    return "…" + value[-3:]
