"""Where evidence becomes authority, or does not.

    AI proposes facts. Deterministic software grants authority.

Everything upstream produces `CallEvidence`. This module is the only thing that
turns evidence into permission to write, and it is a few hundred lines of rules
with no model in them. Four verdicts, in increasing severity, and the run takes
the highest one any single claim reached:

    REFRESH  the provider confirmed what we publish; move the date, change nothing
    APPLY    an explicit, read-back, confirmed change to a low-judgment field
    REVIEW   anything a person should look at before the public sees it
    STOP     end the call, suppress the number, tell a person

The ordering matters more than the names. `max()` over the verdicts of a run is
the run's verdict, so a single unresolved claim pulls the whole run to REVIEW.
That is the behaviour you want: a run that got four things right and one thing
ambiguous is not four fifths safe.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import IntEnum

from callibrate.calling.models import (
    NO_CONTACT_OUTCOMES,
    CallEvidence,
    CallOutcome,
    Claim,
    SafetyEventKind,
)
from callibrate.contracts.models import EscalationCondition, VerificationContract


class Authority(IntEnum):
    """What the software may do, from least to most severe."""

    REFRESH = 0
    APPLY = 1
    REVIEW = 2
    STOP = 3


CANONICAL_SCHEDULE = re.compile(
    r"((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*) "
    r"(\d{2}):(\d{2})[-–](\d{2}):(\d{2})"
)
E164_PHONE = re.compile(r"\+[1-9]\d{7,14}(?:\s+(?:x|ext\.?)[ ]?\d{1,8})?", re.IGNORECASE)

SAFETY_EVENT_CONDITIONS = {
    SafetyEventKind.STOP_REQUESTED: EscalationCondition.STOP_REQUESTED,
    SafetyEventKind.REACHED_CLIENT: EscalationCondition.REACHED_CLIENT,
    SafetyEventKind.DISTRESS: EscalationCondition.DISTRESS,
    SafetyEventKind.HOSTILE: EscalationCondition.DISTRESS,
    SafetyEventKind.WRONG_PARTY: EscalationCondition.WRONG_PARTY,
    SafetyEventKind.NO_DISCLOSURE: EscalationCondition.NO_DISCLOSURE,
}


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    authority: Authority
    reason: str
    claim: Claim | None = None
    field: str | None = None

    @property
    def tier(self) -> int:
        return int(self.authority)


def canonical_schedule(value: str) -> bool:
    match = CANONICAL_SCHEDULE.fullmatch(value)
    if not match:
        return False
    days, open_hour, open_minute, close_hour, close_minute = match.groups()
    day_list = days.split(",")
    return (
        len(day_list) == len(set(day_list))
        and int(open_hour) < 24
        and int(close_hour) < 24
        and int(open_minute) < 60
        and int(close_minute) < 60
    )


def classify_claim(claim: Claim, contract: VerificationContract) -> PolicyDecision:
    """One claim, one verdict. Ordered so the cheapest refusal comes first."""
    requirements = contract.evidence_requirements

    removes = claim.proposed_value is None or claim.removes_service
    if removes and not contract.update_policy.allow_deletion:
        return PolicyDecision(
            Authority.REVIEW,
            "A removal can strand somebody who needs the service.",
            claim,
            claim.field,
        )

    if not contract.may_auto_apply(claim.field):
        return PolicyDecision(
            Authority.REVIEW,
            f"The contract never auto-applies {contract.field_label(claim.field)}.",
            claim,
            claim.field,
        )

    if claim.ambiguous:
        detail = claim.evidence_note or "the answer was hedged or contradicted"
        return PolicyDecision(
            Authority.REVIEW, f"The provider response was not unambiguous: {detail}", claim, claim.field
        )

    if requirements.explicit_statement and not claim.explicit_statement:
        return PolicyDecision(
            Authority.REVIEW,
            "No provider turn in the transcript states this value.",
            claim,
            claim.field,
        )

    if requirements.readback_required and not claim.readback_turn_ids:
        return PolicyDecision(
            Authority.REVIEW,
            f"The value was never read back in full: {claim.evidence_note or 'no readback found'}",
            claim,
            claim.field,
        )

    if requirements.confirmation_required and not claim.confirmation_turn_ids:
        return PolicyDecision(
            Authority.REVIEW,
            "The provider did not plainly agree with the readback.",
            claim,
            claim.field,
        )

    if claim.confidence < requirements.minimum_confidence:
        return PolicyDecision(
            Authority.REVIEW,
            f"Evidence confidence {claim.confidence:.2f} is below the contract's "
            f"{requirements.minimum_confidence:.2f}.",
            claim,
            claim.field,
        )

    if claim.field == "schedule" and not canonical_schedule(claim.proposed_value or ""):
        return PolicyDecision(
            Authority.REVIEW,
            "The hours are not in canonical form, so they cannot be written safely.",
            claim,
            claim.field,
        )

    if claim.field == "phone" and not E164_PHONE.fullmatch(claim.proposed_value or ""):
        return PolicyDecision(
            Authority.REVIEW,
            "The phone number is not in canonical E.164 form.",
            claim,
            claim.field,
        )

    return PolicyDecision(
        Authority.APPLY,
        "The provider stated it, it was read back in full, and they confirmed it.",
        claim,
        claim.field,
    )


def classify(evidence: CallEvidence, contract: VerificationContract) -> list[PolicyDecision]:
    """Every verdict this call produced. Never empty."""
    decisions: list[PolicyDecision] = []

    for event in evidence.safety_events:
        condition = SAFETY_EVENT_CONDITIONS.get(event.kind)
        if condition is None or not contract.escalates_on(condition):
            continue
        authority = (
            Authority.STOP
            if event.kind
            in {
                SafetyEventKind.STOP_REQUESTED,
                SafetyEventKind.DISTRESS,
                SafetyEventKind.HOSTILE,
                SafetyEventKind.REACHED_CLIENT,
                SafetyEventKind.NO_DISCLOSURE,
            }
            else Authority.REVIEW
        )
        decisions.append(
            PolicyDecision(authority, f"Call ended for safety: {event.kind.value}.", None, None)
        )

    if evidence.outcome in NO_CONTACT_OUTCOMES:
        # Nobody was reached. The record is untouched and the task is retried.
        # This is not a review item, and it must never look like one.
        return decisions or [
            PolicyDecision(
                Authority.REFRESH,
                f"No contact was made ({evidence.outcome.value}); the record is unchanged.",
            )
        ]

    if evidence.outcome == CallOutcome.STOP_REQUESTED and contract.escalation_policy.suppress_on_stop_request:
        decisions.append(
            PolicyDecision(Authority.STOP, "The organization asked not to be called again.")
        )

    decisions.extend(classify_claim(claim, contract) for claim in evidence.claims)
    decisions.extend(
        PolicyDecision(
            Authority.REFRESH,
            f"The provider confirmed {contract.field_label(confirmation.field)} is unchanged.",
            None,
            confirmation.field,
        )
        for confirmation in evidence.confirmations
    )

    covered = evidence.covered_fields
    missing = [field for field in contract.fields_to_verify if field not in covered]
    removal_reported = any(claim.removes_service for claim in evidence.claims)
    if missing and not removal_reported and evidence.outcome == CallOutcome.COMPLETED:
        labels = ", ".join(contract.field_label(field) for field in missing)
        decisions.append(
            PolicyDecision(
                Authority.REVIEW,
                f"The call ended without evidence for: {labels}.",
            )
        )

    if not decisions:
        decisions.append(
            PolicyDecision(Authority.REVIEW, "The call established nothing that can be acted on.")
        )
    return decisions


def overall(decisions: list[PolicyDecision]) -> Authority:
    """The run's verdict: the most severe verdict any part of it reached."""
    return max((decision.authority for decision in decisions), default=Authority.REVIEW)


def explain(decisions: list[PolicyDecision]) -> list[dict[str, object]]:
    """A serialisable account of the whole verdict, for the ledger and the console."""
    return [
        {
            "authority": decision.authority.name,
            "tier": decision.tier,
            "reason": decision.reason,
            "field": decision.field,
        }
        for decision in decisions
    ]
