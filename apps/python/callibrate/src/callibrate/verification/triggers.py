"""Why a call happens, and how a record becomes a contract.

Six triggers, one queue. The two that matter for a demonstration are the two
that a person causes: a failed referral, and somebody pressing "verify before I
go". Both produce the same object as a scheduled staleness sweep, and the
evidence rules do not know or care which one it was.

The other half of this module is the translation a record has to survive before
a call is worth placing: current values in canonical form, a phone number in
E.164, a timezone, and the fields actually in doubt. A record that cannot be
turned into a contract is a record that should not be phoned about.
"""

from __future__ import annotations

from typing import Any

from callibrate.contracts.library import community_resource_verification
from callibrate.contracts.models import (
    CallConstraints,
    Trigger,
    TriggerType,
    VerificationContract,
)
from callibrate.policy.call_eligibility import normalise_number

#: What a trigger is worth in the queue. A first-hand report of a wasted trip
#: outranks any amount of passive staleness, because somebody already paid for
#: this record being wrong.
TRIGGER_PRIORITY = {
    TriggerType.FAILED_REFERRAL: 1000.0,
    TriggerType.USER_REPORT: 900.0,
    TriggerType.MANUAL_REQUEST: 950.0,
    TriggerType.EXTERNAL_EVENT: 400.0,
    TriggerType.SCHEDULED_REVERIFY: 200.0,
    TriggerType.STALE_RECORD: 100.0,
}

#: What a reported failure implies about which fields are in doubt.
FAILURE_FIELDS = {
    "disconnected": ["phone"],
    "closed": ["status", "schedule"],
    "wrong_hours": ["schedule"],
    "ineligible": ["eligibility"],
    "moved": ["address"],
    "other": ["status", "schedule"],
}

TRIGGER_MESSAGES = {
    "disconnected": "A visitor reported the published number does not connect.",
    "closed": "A visitor reported a closed door at the published hours.",
    "wrong_hours": "A visitor reported the published hours are wrong.",
    "ineligible": "A visitor reported they were turned away as ineligible.",
    "moved": "A visitor reported the service is not at the published address.",
    "other": "A visitor reported the published information did not match what they found.",
}


class ContractError(ValueError):
    """A record that cannot be phoned about, and the reason."""


def priority_for(trigger: TriggerType, base: float = 0.0) -> float:
    return max(base, TRIGGER_PRIORITY.get(trigger, 100.0))


def fields_for_failure(reason: str) -> list[str]:
    return list(FAILURE_FIELDS.get(reason, FAILURE_FIELDS["other"]))


def message_for_failure(reason: str, details: str = "") -> str:
    base = TRIGGER_MESSAGES.get(reason, TRIGGER_MESSAGES["other"])
    return f"{base} {details}".strip()[:1000]


def build_contract(
    task: dict[str, Any],
    record: dict[str, str],
    *,
    phone: str,
    timezone: str = "America/New_York",
    region: str = "US",
    language: str = "English",
    trigger_message: str = "",
) -> VerificationContract:
    """Turn one claimed queue task into the contract a caller will be given."""
    number = normalise_number(phone)
    if len(number) < 9:
        raise ContractError(
            f"{task['organization_name']} has no phone number in E.164 form, so no call can be "
            "planned for it"
        )
    fields = [field for field in task["fields"] if field]
    if not fields:
        raise ContractError("the task names no fields to verify")

    try:
        trigger_type = TriggerType(task["trigger"])
    except ValueError:
        trigger_type = TriggerType.STALE_RECORD

    return community_resource_verification(
        contract_id=f"vc_{task['id']}",
        record_id=task["service_id"],
        service_name=task["service_name"],
        organization=task["organization_name"],
        phone=number,
        current_record={key: value for key, value in record.items() if key in fields},
        fields=fields,
        trigger=Trigger(type=trigger_type, message=trigger_message),
        timezone=timezone,
        region=region,
    ).model_copy(
        update={
            "call_constraints": CallConstraints(
                language=language, region=region, timezone=timezone
            )
        }
    )
