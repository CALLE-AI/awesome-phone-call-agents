"""Deterministic pre-call gates: necessity, economics, unchanged source.

Three questions are answered here, and none of them is a modelling question.

* **Residual necessity.** A call is only allowed when the ordinary
  digital/document routes are demonstrably exhausted *and* the source record
  does not already answer the question being asked. A portal that states the
  next step has already done this workflow's job.
* **Economics.** Whether pursuing this exception is worth a call is the
  organization's decision, recorded as a policy the organization owns. The
  gate compares supplied record facts against that supplied policy. It never
  estimates a value, a probability or a return; :func:`assess_economics`
  takes no such parameter and nothing a caller passes substitutes for one.
* **Unchanged source.** The claim record this envelope was read from must
  still be the current version at the moment of the check. Write-back re-runs
  this check immediately before mutating; see :mod:`warrantyops.writeback`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum

from .envelope import SourceClaim
from .source import SourceVersionReader

#: The ordinary routes an organization requires before a call is warranted.
#: The set is organization-owned default policy, not a model judgement: a
#: dealer may narrow it, but WarrantyOps never widens it on its own.
DEFAULT_REQUIRED_REMEDIES = (
    "portal_status_check",
    "documented_code_resolution",
    "written_follow_up",
)


class ResidualRefusal(str, Enum):
    """Why this exception is not residual enough to call about."""

    ORDINARY_ROUTE_NOT_EXHAUSTED = "ORDINARY_ROUTE_NOT_EXHAUSTED"
    SOURCE_ALREADY_ANSWERS = "SOURCE_ALREADY_ANSWERS"


@dataclass(frozen=True)
class ResidualDecision:
    allowed: bool
    refusals: tuple[ResidualRefusal, ...]
    missing_remedies: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "refusals": [r.value for r in self.refusals],
            "missing_remedies": list(self.missing_remedies),
        }


def assess_residual_necessity(
    claim: SourceClaim,
    *,
    required_remedies: tuple[str, ...] = DEFAULT_REQUIRED_REMEDIES,
) -> ResidualDecision:
    """Refuse when ordinary routes are not exhausted or the source answers.

    The attempted-channel set is read from the structured exhaustion manifest,
    which the envelope gate has already required and bound to the claim's
    source version. The manifest, not the flat remedy log, is the contract.
    """

    if claim.exhaustion_manifest is not None:
        attempted = set(claim.exhaustion_manifest.channels())
    else:
        # The envelope gate refuses a missing manifest before this gate runs;
        # reading the flat log here only keeps a direct call honest instead of
        # silently refusing, and can never widen what the manifest states.
        attempted = {
            remedy.channel.strip() for remedy in claim.ordinary_remedies if remedy.channel.strip()
        }
    missing = tuple(sorted(set(required_remedies) - attempted))
    refusals: list[ResidualRefusal] = []
    if missing:
        refusals.append(ResidualRefusal.ORDINARY_ROUTE_NOT_EXHAUSTED)
    if (claim.documented_next_step or "").strip():
        refusals.append(ResidualRefusal.SOURCE_ALREADY_ANSWERS)
    return ResidualDecision(
        allowed=not refusals,
        refusals=tuple(refusals),
        missing_remedies=missing,
    )


class EconomicRefusal(str, Enum):
    """Why the organization's own policy does not pay for this call."""

    POLICY_NOT_FOUND = "POLICY_NOT_FOUND"
    CURRENCY_MISMATCH = "CURRENCY_MISMATCH"
    CLAIM_VALUE_UNKNOWN = "CLAIM_VALUE_UNKNOWN"
    BELOW_MINIMUM_VALUE = "BELOW_MINIMUM_VALUE"
    CLAIM_TOO_OLD = "CLAIM_TOO_OLD"
    #: The policy demands a cost comparison and the call price was not
    #: supplied. The gate never estimates a price to fill the gap.
    CALL_COST_UNKNOWN = "CALL_COST_UNKNOWN"
    #: The conclusive refusal: the supplied arithmetic itself shows the call
    #: is not worth placing (value below the policy minimum, or cost above
    #: the policy maximum). The decision carries the arithmetic that produced
    #: it, with every input labelled by who supplied it.
    NOT_WORTH_PURSUING = "NOT_WORTH_PURSUING"


@dataclass(frozen=True)
class EconomicPolicy:
    """An organization-owned pursuit policy. Numbers the org supplied.

    ``policy_id`` is what the envelope references. The model never creates a
    threshold, so there is no threshold anywhere outside records like this.

    ``per_call_price`` is the organization's own current supplied price of one
    call, and ``maximum_call_cost`` the most it will pay for one. Both are
    organization-supplied facts; when a maximum is set but the price is
    missing, the comparison cannot be made and the gate refuses rather than
    estimates.
    """

    policy_id: str
    currency: str
    minimum_claim_value: Decimal
    pursue_when_value_unknown: bool = False
    maximum_age_days: int | None = None
    maximum_call_cost: Decimal | None = None
    per_call_price: Decimal | None = None


#: The synthetic policy book shipped for fixtures and demos. A real
#: deployment replaces it with the organization's own records; the gate code
#: is identical either way.
DEFAULT_POLICY_BOOK: Mapping[str, EconomicPolicy] = {
    "standard-pursuit": EconomicPolicy(
        policy_id="standard-pursuit",
        currency="USD",
        minimum_claim_value=Decimal("250.00"),
        pursue_when_value_unknown=False,
        maximum_age_days=540,
    ),
}


@dataclass(frozen=True)
class EconomicDecision:
    allowed: bool
    policy_id: str | None
    refusals: tuple[EconomicRefusal, ...]
    #: The supplied-facts arithmetic behind the decision, one line per
    #: comparison, every input labelled by who supplied it. Emitted on
    #: allowed decisions too: showing the arithmetic is the point, not an
    #: apology for a refusal.
    arithmetic: tuple[dict[str, object], ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "allowed": self.allowed,
            "policy_id": self.policy_id,
            "refusals": [r.value for r in self.refusals],
            "arithmetic": [dict(line) for line in self.arithmetic],
        }


def _supplied(value: Decimal | int | None, supplied_by: str) -> dict[str, object]:
    """One labelled input. ``None`` is stated as unknown, never estimated."""

    return {
        "value": "unknown" if value is None else str(value),
        "supplied_by": supplied_by,
    }


def assess_economics(
    claim: SourceClaim,
    *,
    policy_book: Mapping[str, EconomicPolicy] = DEFAULT_POLICY_BOOK,
    on: date | None = None,
) -> EconomicDecision:
    """Compare supplied record facts against the supplied organization policy.

    No value, probability or return is estimated here. A missing face value is
    an explicit unknown the policy either tolerates or refuses; a missing call
    price under a policy that demands a cost comparison is the same kind of
    unknown and refuses the same way. Every comparison the gate makes is
    emitted as an arithmetic line with its inputs labelled, so the decision
    can be audited against the records that produced it.
    """

    today = on or date.today()
    policy = policy_book.get(claim.economic_policy_id.strip())
    if policy is None:
        return EconomicDecision(
            allowed=False,
            policy_id=claim.economic_policy_id.strip() or None,
            refusals=(EconomicRefusal.POLICY_NOT_FOUND,),
        )

    arithmetic: list[dict[str, object]] = []
    refusals: list[EconomicRefusal] = []
    not_worth_pursuing = False

    # Value side: the claim's supplied face value against the policy minimum.
    face = claim.claim_face_value
    value_inputs = {
        "claim_face_value": _supplied(face, "source record"),
        "minimum_claim_value": _supplied(policy.minimum_claim_value, "organization policy"),
    }
    if face is None:
        arithmetic.append(
            {
                "statement": "claim_face_value >= minimum_claim_value",
                "inputs": value_inputs,
                "holds": None,
                "note": "face value not supplied; comparison not made",
            }
        )
        if not policy.pursue_when_value_unknown:
            refusals.append(EconomicRefusal.CLAIM_VALUE_UNKNOWN)
    else:
        holds = face >= policy.minimum_claim_value
        arithmetic.append(
            {
                "statement": "claim_face_value >= minimum_claim_value",
                "inputs": value_inputs,
                "holds": holds,
            }
        )
        if claim.claim_currency != policy.currency:
            refusals.append(EconomicRefusal.CURRENCY_MISMATCH)
        if not holds:
            refusals.append(EconomicRefusal.BELOW_MINIMUM_VALUE)
            not_worth_pursuing = True

    # Cost side: the supplied current call price against the policy maximum.
    if policy.maximum_call_cost is not None:
        cost_inputs = {
            "per_call_price": _supplied(policy.per_call_price, "organization policy"),
            "maximum_call_cost": _supplied(policy.maximum_call_cost, "organization policy"),
        }
        if policy.per_call_price is None:
            arithmetic.append(
                {
                    "statement": "per_call_price <= maximum_call_cost",
                    "inputs": cost_inputs,
                    "holds": None,
                    "note": "call price not supplied; comparison not made",
                }
            )
            refusals.append(EconomicRefusal.CALL_COST_UNKNOWN)
        else:
            cost_holds = policy.per_call_price <= policy.maximum_call_cost
            arithmetic.append(
                {
                    "statement": "per_call_price <= maximum_call_cost",
                    "inputs": cost_inputs,
                    "holds": cost_holds,
                }
            )
            if not cost_holds:
                not_worth_pursuing = True

    # Age side: whole supplied days between submission and today.
    if policy.maximum_age_days is not None:
        age = claim.claim_age_days(today)
        age_inputs = {
            "claim_age_days": _supplied(age, "source record"),
            "maximum_age_days": _supplied(policy.maximum_age_days, "organization policy"),
        }
        age_holds = age <= policy.maximum_age_days
        arithmetic.append(
            {
                "statement": "claim_age_days <= maximum_age_days",
                "inputs": age_inputs,
                "holds": age_holds,
            }
        )
        if not age_holds:
            refusals.append(EconomicRefusal.CLAIM_TOO_OLD)

    if not_worth_pursuing:
        refusals.append(EconomicRefusal.NOT_WORTH_PURSUING)

    return EconomicDecision(
        allowed=not refusals,
        policy_id=policy.policy_id,
        refusals=tuple(dict.fromkeys(refusals)),
        arithmetic=tuple(arithmetic),
    )


class VersionRefusal(str, Enum):
    SOURCE_CHANGED = "SOURCE_CHANGED"
    #: No reader was supplied, so the live version could not be re-read. The
    #: check is mandatory before dialing: skipping it silently would let a
    #: stale envelope become a call, so the absence itself is a refusal.
    SOURCE_RECHECK_UNAVAILABLE = "SOURCE_RECHECK_UNAVAILABLE"


@dataclass(frozen=True)
class VersionDecision:
    matches: bool
    envelope_version: str
    current_version: str | None
    refusals: tuple[VersionRefusal, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "matches": self.matches,
            "envelope_version": self.envelope_version,
            "current_version": self.current_version,
            "refusals": [r.value for r in self.refusals],
        }


def check_source_version(
    claim: SourceClaim, reader: SourceVersionReader
) -> VersionDecision:
    """Re-read the authoritative version and compare it to the envelope's.

    Used before dialing and again, by :mod:`warrantyops.writeback`,
    immediately before any mutation. An earlier pass never satisfies a later
    check; each call re-reads.
    """

    current = reader.current_version(claim.source_platform, claim.source_claim_id)
    matches = current is not None and current == claim.source_version
    return VersionDecision(
        matches=matches,
        envelope_version=claim.source_version,
        current_version=current,
        refusals=() if matches else (VersionRefusal.SOURCE_CHANGED,),
    )
