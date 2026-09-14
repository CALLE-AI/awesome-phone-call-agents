"""The source-claim envelope: what the system of record already states.

WarrantyOps is residual by design. It is only allowed to call about a claim
after the ordinary digital and document routes have demonstrably failed, and
every fact the pre-call gates decide on is a fact the source system or the
organization supplied. Nothing in this module is inferred, estimated or scored:
if the source does not state it, the envelope leaves it unknown, and a gate
that needs it refuses.

The envelope is deliberately a *record*, not a judgment. ``documented_reason``
is the reject/return text the portal already shows; ``documented_next_step``
is the next action the portal already states, or ``None`` when the source gives
no actionable next step. That distinction is what the residual-necessity gate
in :mod:`warrantyops.gates` reads: a source that already says what to do next
answers the question, and no call may be placed about it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from .authorization import E164_RE

#: ISO 4217-style currency code. Three letters is a shape check, not a claim
#: that the code is real; the economic gate still compares it against the
#: organization's policy currency before any value judgement is made.
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


class ExceptionStatus(str, Enum):
    """Why this submitted claim is an exception in the source system."""

    REJECTED = "REJECTED"
    RETURNED = "RETURNED"
    UNPAID = "UNPAID"
    STALLED = "STALLED"


class EnvelopeRefusal(str, Enum):
    """Why an envelope is not a basis for any further step."""

    MISSING_SOURCE_PLATFORM = "MISSING_SOURCE_PLATFORM"
    MISSING_SOURCE_CLAIM_ID = "MISSING_SOURCE_CLAIM_ID"
    MISSING_SOURCE_VERSION = "MISSING_SOURCE_VERSION"
    MISSING_EXCEPTION_STATUS = "MISSING_EXCEPTION_STATUS"
    MISSING_SUBMITTED_AT = "MISSING_SUBMITTED_AT"
    SUBMITTED_IN_THE_FUTURE = "SUBMITTED_IN_THE_FUTURE"
    MISSING_ORGANIZATION = "MISSING_ORGANIZATION"
    MISSING_ACCOUNT_CONTEXT = "MISSING_ACCOUNT_CONTEXT"
    INVALID_PHONE = "INVALID_PHONE"
    MISSING_POLICY_ID = "MISSING_POLICY_ID"
    VALUE_WITHOUT_CURRENCY = "VALUE_WITHOUT_CURRENCY"
    CURRENCY_WITHOUT_VALUE = "CURRENCY_WITHOUT_VALUE"
    INVALID_CLAIM_VALUE = "INVALID_CLAIM_VALUE"
    REMEDY_MISSING_CHANNEL = "REMEDY_MISSING_CHANNEL"
    REMEDY_MISSING_OUTCOME = "REMEDY_MISSING_OUTCOME"
    #: No structured exhaustion manifest was supplied with the envelope. The
    #: claim adapter layer owes the kernel this record; without it the kernel
    #: cannot see that the ordinary routes were actually attempted.
    MISSING_EXHAUSTION_MANIFEST = "MISSING_EXHAUSTION_MANIFEST"
    #: A manifest was supplied but it is not a complete record for *this*
    #: source version: no routes, a route with no outcome, no stated
    #: information gap, or a binding to a different ``source_version``.
    EXHAUSTION_MANIFEST_INCOMPLETE = "EXHAUSTION_MANIFEST_INCOMPLETE"


@dataclass(frozen=True)
class OrdinaryRemedy:
    """One ordinary digital/document route already attempted.

    ``outcome`` is what that route produced, in the organization's own words.
    "No reply after five business days" is an outcome; so is "code documented,
    guidance does not cover this situation".
    """

    channel: str
    outcome: str


@dataclass(frozen=True)
class ExhaustionRoute:
    """One ordinary route as the structured exhaustion manifest states it.

    ``attempted_at`` is optional because not every system of record timestamps
    a portal visit; ``channel`` and ``outcome`` are not optional, because a
    route without an outcome has not demonstrated that it was tried to its end.
    """

    channel: str
    outcome: str
    attempted_at: date | None = None


@dataclass(frozen=True)
class ExhaustionManifest:
    """The structured record that ordinary routes were tried and failed.

    Supplied by the claim adapter layer alongside the envelope — never
    produced by this application — and bound to one ``source_version``: a
    manifest written for an earlier version of the record describes routes
    attempted against different facts, so for this version it is incomplete.

    This is a validated structured record, not a signed attestation. No
    cryptographic claim is made; a real DMS trust root is a future
    DMS-adapter concern.

    ``information_gap`` states, in the organization's words, what the source
    record still cannot answer after every listed route. That sentence is
    what makes the call residual: a manifest whose routes all succeeded has
    no gap and no call.
    """

    source_version: str
    routes: tuple[ExhaustionRoute, ...] = ()
    information_gap: str = ""

    def channels(self) -> tuple[str, ...]:
        """The channels this manifest states were attempted, in order."""

        return tuple(route.channel.strip() for route in self.routes if route.channel.strip())

    def to_dict(self) -> dict[str, object]:
        return {
            "source_version": self.source_version,
            "routes": [
                {
                    "channel": route.channel,
                    "outcome": route.outcome,
                    "attempted_at": route.attempted_at.isoformat() if route.attempted_at else None,
                }
                for route in self.routes
            ],
            "information_gap": self.information_gap,
        }


def validate_exhaustion_manifest(
    claim: SourceClaim, manifest: ExhaustionManifest | None
) -> tuple[EnvelopeRefusal, ...]:
    """Every way this manifest fails as a complete record for this claim.

    ``None`` is the missing manifest. Empty refusals mean the manifest is
    structurally complete and bound to the envelope's own ``source_version``.
    The kernel refuses the run before any gate that would otherwise have to
    trust the manifest. Whether the routes attempted cover the organization's
    required set is a separate question answered by the residual-necessity
    gate in :mod:`warrantyops.gates`.
    """

    if manifest is None:
        return (EnvelopeRefusal.MISSING_EXHAUSTION_MANIFEST,)
    refusals: list[EnvelopeRefusal] = []
    if (
        not manifest.source_version.strip()
        or manifest.source_version.strip() != claim.source_version.strip()
    ):
        refusals.append(EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE)
    if not manifest.routes:
        refusals.append(EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE)
    for route in manifest.routes:
        if not route.channel.strip() or not route.outcome.strip():
            refusals.append(EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE)
    if not manifest.information_gap.strip():
        refusals.append(EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE)
    return tuple(dict.fromkeys(refusals))


@dataclass(frozen=True)
class SourceClaim:
    """A submitted warranty claim as the source system states it.

    ``source_version`` is the immutable version token of the record this
    envelope was read from. The idempotency key is derived from it, the
    pre-call check re-reads it, and write-back refuses if it moved.
    """

    source_platform: str
    source_claim_id: str
    source_version: str
    exception_status: ExceptionStatus
    submitted_at: date
    caller_organization: str
    account_context: str
    counterparty_phone_e164: str
    economic_policy_id: str
    claim_face_value: Decimal | None = None
    claim_currency: str | None = None
    documented_code: str | None = None
    documented_reason: str | None = None
    documented_next_step: str | None = None
    ordinary_remedies: tuple[OrdinaryRemedy, ...] = ()
    #: The structured exhaustion manifest is required by the envelope gate.
    #: ``ordinary_remedies`` is retained as the flat lineage of the same fact;
    #: the manifest is the contract the gates read.
    exhaustion_manifest: ExhaustionManifest | None = None

    def identity(self) -> str:
        """The claim's identity across versions: platform plus claim id."""

        return f"{self.source_platform}/{self.source_claim_id}"

    def claim_age_days(self, on: date) -> int:
        """Whole days from submission to ``on``. Supplied facts only."""

        return (on - self.submitted_at).days


@dataclass(frozen=True)
class EnvelopeDecision:
    ok: bool
    refusals: tuple[EnvelopeRefusal, ...]

    def to_dict(self) -> dict[str, object]:
        return {"ok": self.ok, "refusals": [r.value for r in self.refusals]}


def validate_source_claim(claim: SourceClaim, *, on: date | None = None) -> EnvelopeDecision:
    """Validate the envelope as a fact record. Refusals are named, not summed."""

    today = on or date.today()
    refusals: list[EnvelopeRefusal] = []

    if not claim.source_platform.strip():
        refusals.append(EnvelopeRefusal.MISSING_SOURCE_PLATFORM)
    if not claim.source_claim_id.strip():
        refusals.append(EnvelopeRefusal.MISSING_SOURCE_CLAIM_ID)
    if not claim.source_version.strip():
        refusals.append(EnvelopeRefusal.MISSING_SOURCE_VERSION)

    if E164_RE.fullmatch(claim.counterparty_phone_e164) is None:
        refusals.append(EnvelopeRefusal.INVALID_PHONE)
    if not claim.economic_policy_id.strip():
        refusals.append(EnvelopeRefusal.MISSING_POLICY_ID)

    if not claim.caller_organization.strip():
        refusals.append(EnvelopeRefusal.MISSING_ORGANIZATION)
    if not claim.account_context.strip():
        refusals.append(EnvelopeRefusal.MISSING_ACCOUNT_CONTEXT)

    if claim.submitted_at is None:
        refusals.append(EnvelopeRefusal.MISSING_SUBMITTED_AT)
    elif claim.submitted_at > today:
        refusals.append(EnvelopeRefusal.SUBMITTED_IN_THE_FUTURE)

    value, currency = claim.claim_face_value, claim.claim_currency
    if value is not None and not (currency or "").strip():
        refusals.append(EnvelopeRefusal.VALUE_WITHOUT_CURRENCY)
    if value is None and (currency or "").strip():
        refusals.append(EnvelopeRefusal.CURRENCY_WITHOUT_VALUE)
    if value is not None and value < 0:
        refusals.append(EnvelopeRefusal.INVALID_CLAIM_VALUE)
    if currency is not None and currency and _CURRENCY_RE.fullmatch(currency) is None:
        refusals.append(EnvelopeRefusal.INVALID_CLAIM_VALUE)

    for remedy in claim.ordinary_remedies:
        if not remedy.channel.strip():
            refusals.append(EnvelopeRefusal.REMEDY_MISSING_CHANNEL)
        if not remedy.outcome.strip():
            refusals.append(EnvelopeRefusal.REMEDY_MISSING_OUTCOME)

    refusals.extend(validate_exhaustion_manifest(claim, claim.exhaustion_manifest))

    return EnvelopeDecision(ok=not refusals, refusals=tuple(dict.fromkeys(refusals)))


def manifest_from_dict(data: dict[str, Any]) -> ExhaustionManifest:
    """Build a manifest from a fixture or exported record."""

    routes = tuple(
        ExhaustionRoute(
            channel=str(item["channel"]),
            outcome=str(item["outcome"]),
            attempted_at=(
                date.fromisoformat(str(item["attempted_at"]))
                if item.get("attempted_at")
                else None
            ),
        )
        for item in data.get("routes") or ()
    )
    return ExhaustionManifest(
        source_version=str(data.get("source_version", "")),
        routes=routes,
        information_gap=str(data.get("information_gap", "")),
    )


def source_claim_from_dict(data: dict[str, Any]) -> SourceClaim:
    """Build an envelope from a fixture or exported record.

    The claim face value is read as a string and parsed as ``Decimal`` so a
    synthetic fixture and a real export produce the same number, never a float.
    """

    remedies = tuple(
        OrdinaryRemedy(channel=str(item["channel"]), outcome=str(item["outcome"]))
        for item in data.get("ordinary_remedies") or ()
    )
    manifest_data = data.get("exhaustion_manifest")
    manifest: ExhaustionManifest | None = None
    if manifest_data is not None:
        manifest = manifest_from_dict(manifest_data)
    raw_value = data.get("claim_face_value")
    value: Decimal | None = None
    if raw_value is not None and str(raw_value).strip() != "":
        try:
            value = Decimal(str(raw_value).strip())
        except InvalidOperation as error:
            raise ValueError(f"claim_face_value is not a decimal: {raw_value!r}") from error
    return SourceClaim(
        source_platform=str(data["source_platform"]),
        source_claim_id=str(data["source_claim_id"]),
        source_version=str(data["source_version"]),
        exception_status=ExceptionStatus(data["exception_status"]),
        submitted_at=date.fromisoformat(str(data["submitted_at"])),
        caller_organization=str(data["caller_organization"]),
        account_context=str(data["account_context"]),
        counterparty_phone_e164=str(data["counterparty_phone_e164"]),
        economic_policy_id=str(data["economic_policy_id"]),
        claim_face_value=value,
        claim_currency=data.get("claim_currency"),
        documented_code=data.get("documented_code"),
        documented_reason=data.get("documented_reason"),
        documented_next_step=data.get("documented_next_step"),
        ordinary_remedies=remedies,
        exhaustion_manifest=manifest,
    )
