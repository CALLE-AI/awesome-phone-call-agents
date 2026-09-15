"""Four worked contract shapes, to show the primitive is not one directory's shape.

The live application in this repository is the community-resource case. These
exist so the other three are a schema and a test rather than a paragraph in a
README: each one names different fields, a different escalation set and a
different sentence for the provider, and each is exercised in
`tests/test_contract_library.py`.
"""

from __future__ import annotations

from callibrate.contracts.models import (
    CallConstraints,
    EscalationCondition,
    EscalationPolicy,
    EvidenceRequirements,
    Subject,
    SubjectType,
    Trigger,
    TriggerType,
    UpdatePolicy,
    VerificationContract,
)


def community_resource_verification(
    *,
    contract_id: str,
    record_id: str,
    service_name: str,
    organization: str,
    phone: str,
    current_record: dict[str, str],
    fields: list[str],
    trigger: Trigger,
    timezone: str = "America/New_York",
    region: str = "US",
) -> VerificationContract:
    """A food bank, shelter or clinic listing that somebody may travel to."""
    return VerificationContract(
        id=contract_id,
        subject=Subject(
            type=SubjectType.COMMUNITY_SERVICE,
            name=service_name,
            organization=organization,
            record_id=record_id,
        ),
        authoritative_phone=phone,
        current_record=current_record,
        fields_to_verify=fields,  # type: ignore[arg-type]
        trigger=trigger,
        call_constraints=CallConstraints(timezone=timezone, region=region),
    )


def business_hours_verification(
    *,
    contract_id: str,
    record_id: str,
    business_name: str,
    phone: str,
    published_hours: str,
    trigger: Trigger,
    timezone: str = "America/New_York",
    region: str = "US",
) -> VerificationContract:
    """A directory or storefront listing whose hours drift without anyone noticing."""
    return VerificationContract(
        id=contract_id,
        subject=Subject(
            type=SubjectType.BUSINESS_HOURS, name=business_name, record_id=record_id
        ),
        authoritative_phone=phone,
        current_record={"schedule": published_hours},
        fields_to_verify=["schedule"],
        trigger=trigger,
        update_policy=UpdatePolicy(
            auto_apply_fields=["schedule"], never_auto_apply_fields=["status", "eligibility"]
        ),
        call_constraints=CallConstraints(timezone=timezone, region=region),
    )


def appointment_availability_verification(
    *,
    contract_id: str,
    record_id: str,
    practice_name: str,
    phone: str,
    published_wait: str,
    trigger: Trigger,
    timezone: str = "America/New_York",
    region: str = "US",
) -> VerificationContract:
    """Whether a desk is taking bookings, and how far out. Never auto-applied.

    Availability is a claim about the future, so a single answer is a data point
    and not a fact about the record. This contract keeps every field out of the
    auto-apply set on purpose.
    """
    return VerificationContract(
        id=contract_id,
        subject=Subject(
            type=SubjectType.APPOINTMENT_AVAILABILITY, name=practice_name, record_id=record_id
        ),
        authoritative_phone=phone,
        current_record={"application_process": published_wait},
        fields_to_verify=["application_process"],
        trigger=trigger,
        update_policy=UpdatePolicy(
            auto_apply_fields=[], never_auto_apply_fields=["status", "eligibility"]
        ),
        call_constraints=CallConstraints(timezone=timezone, region=region),
    )


def provider_network_verification(
    *,
    contract_id: str,
    record_id: str,
    practice_name: str,
    phone: str,
    published_eligibility: str,
    trigger: Trigger,
    timezone: str = "America/New_York",
    region: str = "US",
) -> VerificationContract:
    """Whether a clinic still takes a given insurance. Eligibility is always human.

    A wrong answer here sends somebody to an appointment they will be billed for,
    so the readback is mandatory and the field is never auto-applied.
    """
    return VerificationContract(
        id=contract_id,
        subject=Subject(
            type=SubjectType.PROVIDER_NETWORK, name=practice_name, record_id=record_id
        ),
        authoritative_phone=phone,
        current_record={"eligibility": published_eligibility},
        fields_to_verify=["eligibility"],
        trigger=trigger,
        evidence_requirements=EvidenceRequirements(minimum_confidence=0.95),
        update_policy=UpdatePolicy(auto_apply_fields=[], never_auto_apply_fields=["status", "eligibility"]),
        escalation_policy=EscalationPolicy(
            escalate_if=[
                *EscalationCondition,
            ]
        ),
        call_constraints=CallConstraints(timezone=timezone, region=region),
    )


CONTRACT_LIBRARY = {
    "community_resource": community_resource_verification,
    "business_hours": business_hours_verification,
    "appointment_availability": appointment_availability_verification,
    "provider_network": provider_network_verification,
}


def manual_trigger(message: str) -> Trigger:
    return Trigger(type=TriggerType.MANUAL_REQUEST, message=message)
