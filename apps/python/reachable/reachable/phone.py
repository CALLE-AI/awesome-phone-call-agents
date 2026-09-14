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

#: UK mobile numbers reserved by Ofcom for drama and fiction: +447700900000 to
#: +447700900999, a fixed prefix plus exactly three digits. Every fixture
#: contact uses this range, because a fixture number must never be able to ring
#: a real subscriber.
DRAMA_RE = re.compile(r"^\+447700900[0-9]{3}$")

#: Country codes whose national numbering plan uses a leading 0 as a trunk
#: prefix that must be dropped in E.164. Kept deliberately narrow: only codes
#: where a leading 0 in the national part is unambiguously a mistake.
TRUNK_PREFIX_COUNTRY_CODES = ("44",)

#: Ofcom also reserves landline ranges for drama, including 01632 960000-960999.
#: Kept separate from DRAMA_RE because the fixture range in docs/SAFETY.md is the
#: mobile one; this exists so tests that need a number *outside* the fixture
#: range still use one that cannot ring.
RESERVED_LANDLINE_RE = re.compile(r"^\+441632960[0-9]{3}$")


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

    # E.164 syntax alone cannot catch a trunk prefix left in by mistake:
    # "+44" followed by the national number *including* its leading 0 is
    # structurally valid and is not the number anybody meant. It is the most
    # common way a UK number gets mistyped, and dialling it would reach
    # something unintended. Refused, not repaired -- dropping the zero would be
    # guessing whose telephone rings.
    for country_code in TRUNK_PREFIX_COUNTRY_CODES:
        rest = value[1:]
        if rest.startswith(country_code) and rest[len(country_code) :].startswith("0"):
            raise InvalidPhoneNumber(
                f"phone number has a national trunk prefix after +{country_code}; "
                "drop the leading 0 from the national number"
            )
    return value


def is_e164(raw: str | None) -> bool:
    try:
        validate_e164(raw)
    except InvalidPhoneNumber:
        return False
    return True


def is_drama_number(raw: str | None) -> bool:
    """True for Ofcom's reserved drama mobile range, which can never ring."""
    return bool(DRAMA_RE.match((raw or "").strip()))


def is_reserved_number(raw: str | None) -> bool:
    """True for any Ofcom range reserved for drama and fiction.

    Broader than :func:`is_drama_number`: used by the repository-hygiene test to
    assert that no number anywhere in the app could reach a real subscriber,
    including in tests that deliberately need a number outside the fixture range.
    """
    value = (raw or "").strip()
    return bool(DRAMA_RE.match(value) or RESERVED_LANDLINE_RE.match(value))


def mask(raw: str | None) -> str:
    """Render a number for display: the last three digits only.

    Used in the dashboard, logs, audit rows, exports and CLI output -- every
    display surface, not private destination/evidence storage. An unusable value masks to a
    placeholder rather than raising: a masking helper must never be the thing
    that takes the dashboard down.
    """
    value = (raw or "").strip()
    if len(value) < 3:
        return "***"
    return "…" + value[-3:]


# Display-only heuristic for E.164 and common national formatting. Leave ISO
# dates intact. This is not an anonymiser for spelled-out numbers or other PII.
_DISPLAY_PHONE_RE = re.compile(
    r"(?<![\w-])(?:\+[1-9](?:[ ().-]*[0-9]){7,14}|"
    r"(?![0-9]{4}-[0-9]{2}-[0-9]{2})\(?[0-9](?:[ ().-]*[0-9]){9,14})(?!\w)"
)


def mask_display(value: object) -> object:
    """Return a masked presentation copy without changing private evidence."""
    if isinstance(value, str):
        return _DISPLAY_PHONE_RE.sub(
            lambda match: mask(re.sub(r"[^0-9]", "", match.group())), value
        )
    if isinstance(value, dict):
        return {key: mask_display(item) for key, item in value.items()}
    if isinstance(value, list):
        return [mask_display(item) for item in value]
    if isinstance(value, tuple):
        return tuple(mask_display(item) for item in value)
    return value
