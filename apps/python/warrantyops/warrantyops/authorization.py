"""Authorization basis for placing a call.

A phone call is a side effect on somebody else's day. This module holds the
record that says why this number may be dialled for this purpose, and refuses
the call when that record does not hold. It is domain-independent: the purpose
string is supplied by the caller.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

#: E.164, using the stricter of the two patterns CALL-E publishes: the Goal Run
#: ``phone`` pattern ``^\+[1-9]\d{7,14}$``. The Calls API accepts one digit
#: fewer; refusing the shorter form here can only reject a number CALL-E would
#: have accepted, never accept one it would reject.
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")


class AuthorizationBasis(str, Enum):
    """Why this recipient may be called."""

    OWNED_NUMBER = "OWNED_NUMBER"
    WRITTEN_CONSENT = "WRITTEN_CONSENT"
    EXISTING_SERVICE_RELATIONSHIP = "EXISTING_SERVICE_RELATIONSHIP"
    TEST_RECIPIENT_CONSENT = "TEST_RECIPIENT_CONSENT"


class AuthorizationRefusal(str, Enum):
    """Why a call was refused before it was placed."""

    INVALID_E164 = "INVALID_E164"
    MISSING_PURPOSE = "MISSING_PURPOSE"
    PURPOSE_MISMATCH = "PURPOSE_MISMATCH"
    EXPIRED = "EXPIRED"
    NOT_YET_VALID = "NOT_YET_VALID"
    MISSING_RECORD_REFERENCE = "MISSING_RECORD_REFERENCE"
    RECIPIENT_NOT_ALLOWLISTED = "RECIPIENT_NOT_ALLOWLISTED"
    #: The authorization names a number other than the claim's counterparty.
    #: An authorization record is for one destination; it cannot be replayed
    #: onto a different claim's number.
    AUTHORIZED_RECIPIENT_MISMATCH = "AUTHORIZED_RECIPIENT_MISMATCH"


@dataclass(frozen=True)
class CallAuthorization:
    """A pointer to an authorization record, not the record itself.

    ``record_reference`` names where the signed consent, contract clause or
    ownership proof is filed. The document never enters this repository.
    """

    recipient_e164: str
    basis: AuthorizationBasis
    purpose: str
    granted_by: str
    granted_at: datetime
    expires_at: datetime
    record_reference: str


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    refusals: tuple[AuthorizationRefusal, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "refusals": [refusal.value for refusal in self.refusals],
        }


def mask_e164(number: str) -> str:
    """Mask a number for any output a human or a log will see."""

    if not number:
        return ""
    digits = number[1:] if number.startswith("+") else number
    if len(digits) <= 6:
        return "+" + "*" * len(digits)
    return f"+{digits[:2]}{'*' * (len(digits) - 4)}{digits[-2:]}"


def normalize_e164(number: str) -> str:
    """Canonical form for comparing two numbers: surrounding whitespace off.

    Nothing more aggressive is done, deliberately. A valid E.164 number has no
    internal formatting to strip — :data:`E164_RE` refuses spaces, dashes and
    dots — so two numbers either match exactly once trimmed, or they are
    genuinely different destinations.
    """

    return (number or "").strip()


def authorize_call(
    authorization: CallAuthorization,
    *,
    requested_purpose: str,
    now: datetime | None = None,
    allowlist: frozenset[str] | None = None,
) -> AuthorizationDecision:
    """Decide whether this call may be placed. Refusals are named, not summed."""

    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    refusals: list[AuthorizationRefusal] = []

    if E164_RE.fullmatch(authorization.recipient_e164) is None:
        refusals.append(AuthorizationRefusal.INVALID_E164)

    if not requested_purpose.strip() or not authorization.purpose.strip():
        refusals.append(AuthorizationRefusal.MISSING_PURPOSE)
    elif requested_purpose.strip() != authorization.purpose.strip():
        refusals.append(AuthorizationRefusal.PURPOSE_MISMATCH)

    if not authorization.record_reference.strip():
        refusals.append(AuthorizationRefusal.MISSING_RECORD_REFERENCE)

    granted_at = authorization.granted_at
    expires_at = authorization.expires_at
    if granted_at.tzinfo is None or expires_at.tzinfo is None:
        raise ValueError("authorization timestamps must be timezone-aware")
    if moment < granted_at:
        refusals.append(AuthorizationRefusal.NOT_YET_VALID)
    if moment >= expires_at:
        refusals.append(AuthorizationRefusal.EXPIRED)

    if allowlist is not None and authorization.recipient_e164 not in allowlist:
        refusals.append(AuthorizationRefusal.RECIPIENT_NOT_ALLOWLISTED)

    return AuthorizationDecision(allowed=not refusals, refusals=tuple(refusals))
