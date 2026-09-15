"""Core types for Certa.

Two boundaries live here, and both are enforced by construction rather than by
policy a caller can forget:

1. Consent. A phone number can only reach the dialer as a
   `ConsentedEmployerContact`, and that type cannot be built without a consent
   receipt whose token verifies against the row's own content.

2. Provenance. The dialer accepts only a `SourcedNumber`, which carries where
   the number came from. The number written on an application is an
   `ApplicantSuppliedNumber` -- a separate type with no conversion into a
   `SourcedNumber`. Fraudulent applications supply working numbers answered by
   staffed call centres, so the applicant-supplied number is the one field an
   applicant fully controls and is never dialed.

Both types use a module-private sentinel so they cannot be instantiated
directly; only the factories in this module can produce them, and the factories
enforce the invariants.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# CALL-E's OpenAPI contract for recipient phone numbers:
#   pattern: "^\\+[1-9]\\d{6,14}$"
# Numbers are never repaired, normalised or given an inferred country code.
# A number that does not already match is rejected, not fixed.
#
# Two deliberate departures from a naive translation of that pattern:
#
#   `\d` matches Unicode decimal digits in Python, so "+1" followed by nine
#   Arabic-Indic digits satisfied the pattern and resolved to a US
#   destination. `[0-9]` keeps it to the digits E.164 actually defines.
#
#   `$` also matches just before a trailing newline, so "+15551234567\n"
#   passed. `fullmatch` against the whole string is used everywhere instead
#   of `match`, and `\Z` anchors the pattern for any caller that reaches for
#   `.match` out of habit.
E164 = re.compile(r"\A\+[1-9][0-9]{6,14}\Z", re.ASCII)

# Only the factories below hold this. Passing anything else to a guarded
# __init__ raises, which is what makes "cannot be constructed" true rather
# than merely documented.
_GUARD = object()


class BoundaryError(Exception):
    """A construction was attempted that a boundary forbids."""


def mask(phone: str) -> str:
    """Render a phone number for humans and logs: last four digits only.

    Every user-facing surface, log line and audit record goes through this.
    There is deliberately no code path that renders a full number.
    """
    if not phone:
        return "(no number)"
    tail = phone[-4:]
    return f"{phone[:2]}{'•' * max(len(phone) - 6, 1)}{tail}"


# A phone number inside free text: seven or more digits, optionally grouped
# by the usual separators, optionally with a country code. Deliberately not
# anchored to E.164, because the text being scanned was written by a provider
# and can spell a number any way it likes.
# A date is a run of digits with separators too, and masking one helps
# nobody. Timestamps ending in a letter are already excluded by the
# lookahead above; a bare ISO date is not.
_DATE_LIKE = re.compile(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}")

_PHONE_IN_TEXT = re.compile(
    r"(?<![\w.])(\+?\d(?:[\d\s().\-]{5,}\d))(?![\w.])"
)


def redact(text: str) -> str:
    """Mask anything phone-shaped inside provider-written text.

    `mask` renders a number we already hold. This handles the other
    direction: evidence strings, summaries, failure bodies and disposition
    reasons come back from CALL-E and go on to an Airtable cell, the
    console and the audit log, and any of them may quote a number back at
    us. The operator's own inputs are untouched -- this runs on output, so
    the number actually dialed still travels intact to the provider.

    A date, a decimal or an identifier with word characters around it is
    left alone; only a run of digits long enough to be a phone number and
    standing on its own is masked.
    """
    if not text:
        return text

    def _mask(match: re.Match[str]) -> str:
        raw = match.group(1)
        if _DATE_LIKE.fullmatch(raw.strip()):
            return raw
        digits = re.sub(r"\D", "", raw)
        if len(digits) < 7:
            return raw
        return mask(digits)

    return _PHONE_IN_TEXT.sub(_mask, text)


class NumberSource(str, Enum):
    """Where a dialable number came from.

    There is no `APPLICATION` member, and adding one would be a defect rather
    than a feature: it would create the very path boundary 2 exists to prevent.
    """

    OFFICIAL_SITE = "official_site"
    BUSINESS_REGISTRY = "business_registry"
    DIRECTORY = "directory"
    KNOWN_EMPLOYER_RECORD = "known_employer_record"


class Relationship(str, Enum):
    """Closed set of parties this tool may contact.

    Employment verification contacts an employer. It does not contact
    neighbours, colleagues, previous partners, or anyone else an applicant did
    not name -- that product is the one regulators wrote rules against.
    """

    EMPLOYER = "employer"


@dataclass(frozen=True, slots=True)
class ApplicantSuppliedNumber:
    """The employer number written on the application.

    Kept for the record and for comparison against an independently sourced
    number. It is a terminal type: nothing in this package converts it into a
    `SourcedNumber`, and `tests/test_boundaries.py` asserts that no such
    conversion exists.
    """

    raw: str

    def masked(self) -> str:
        return mask(self.raw)


@dataclass(frozen=True, slots=True)
class SourcedNumber:
    """A dialable number, with provenance.

    Build through `source_number()`. The `source` field records how the number
    was obtained so an audit can show the dialed number did not come from the
    application.
    """

    e164: str
    source: NumberSource
    note: str = ""
    _guard: Any = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._guard is not _GUARD:
            raise BoundaryError(
                "SourcedNumber must be built through source_number(); direct "
                "construction would bypass provenance and E.164 checks"
            )

    def masked(self) -> str:
        return mask(self.e164)


def source_number(e164: str, source: NumberSource, note: str = "") -> SourcedNumber:
    """Validate and tag an independently obtained employer number.

    Raises BoundaryError if the number is not already valid E.164. Numbers are
    never repaired: a missing country code is a data problem for a human, not
    something to guess.
    """
    if not isinstance(source, NumberSource):
        raise BoundaryError(f"unknown number source: {source!r}")
    if not E164.fullmatch(e164 or ""):
        raise BoundaryError(
            "number is not E.164 and will not be repaired or inferred: "
            f"{mask(e164 or '')}"
        )
    return SourcedNumber(e164=e164, source=source, note=note, _guard=_GUARD)


@dataclass(frozen=True, slots=True)
class ConsentReceipt:
    """Evidence that the applicant agreed to this contact, for this purpose.

    `disclosure_version` is part of the consent token, so changing what the
    applicant was told invalidates consent gathered under the old text.
    """

    receipt_id: str
    disclosure_version: str
    signed_at: str  # ISO-8601 UTC

    def __post_init__(self) -> None:
        if not self.receipt_id or not self.disclosure_version or not self.signed_at:
            raise BoundaryError("consent receipt is incomplete")


@dataclass(frozen=True, slots=True)
class VerificationRequest:
    """One employment verification, as the operator's table holds it."""

    request_id: str
    applicant_ref: str
    employer_name: str
    applicant_name: str = ""
    consent: ConsentReceipt | None = None
    applicant_supplied: ApplicantSuppliedNumber | None = None
    sourced: SourcedNumber | None = None
    cancelled: bool = False

    def __post_init__(self) -> None:
        if not self.request_id or not self.applicant_ref:
            raise BoundaryError("verification request is missing an identifier")


@dataclass(frozen=True, slots=True)
class ConsentedEmployerContact:
    """The only type the dialer accepts.

    Build through `certa.consent.authorize()`. Holding one of these is proof
    that a consent receipt existed, that its token verified against this row's
    own content, and that the number carries independent provenance.
    """

    request_id: str
    applicant_ref: str
    employer_name: str
    applicant_name: str
    number: SourcedNumber
    relationship: Relationship
    consent_receipt_id: str
    consent_token: str
    task_spec_version: str
    _guard: Any = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._guard is not _GUARD:
            raise BoundaryError(
                "ConsentedEmployerContact must be built through "
                "certa.consent.authorize(); direct construction would bypass "
                "the consent boundary"
            )

    def masked_number(self) -> str:
        return self.number.masked()


def _build_consented_contact(**kwargs: Any) -> ConsentedEmployerContact:
    """Private factory. Imported only by `certa.consent`."""
    return ConsentedEmployerContact(**kwargs, _guard=_GUARD)
