"""Small builders shared by the capture, conflict and invariant suites.

Kept out of the test modules so that a capture test and a property test are
demonstrably grading the *same* shape of call.
"""

from __future__ import annotations

from datetime import date

from afterword.models import (
    DirectDebits,
    Estate,
    Institution,
    InstitutionKind,
    Observations,
    PriorCall,
    Reached,
    RecordedPolicy,
    Requirement,
    Ternary,
)

RUN_ID = "afterword_est-0001_inst-0001"

#: What the institution publishes. One of the two sides of any dispute.
POLICY = RecordedPolicy(
    department="Bereavement Team",
    documents_needed=(
        "certified copy of the death certificate",
        "grant of probate",
    ),
    certified_copy_accepted=Ternary.YES,
    direct_debits_action=DirectDebits.FROZEN,
    source="bereavement guide published 2026",
)

#: An earlier call to the same institution that answered differently.
PRIOR = PriorCall(
    call_id="call-0001",
    captured_on=date(2026, 9, 1),
    requirement=Requirement(
        department="Bereavement Team",
        documents_needed=("original death certificate",),
        certified_copy_accepted=Ternary.NO,
        direct_debits_action=DirectDebits.FROZEN,
        reference_opened="BRV-0001",
    ),
)


def make_estate(**overrides: object) -> Estate:
    """An estate holding more than the agent may say, which is the normal case."""
    fields: dict[str, object] = {
        "estate_id": "est-0001",
        "deceased_name": "Iris Kowalczyk",
        "executor_name": "Anna Kowalczyk",
        "reference": "PRB-0001",
        "executor_relationship": "daughter",
        "date_of_birth": date(1941, 7, 3),
        "cause_of_death": "heart failure",
        "estimated_balance": "2,140.55",
        "notes": "joint account held with her late husband",
    }
    fields.update(overrides)
    return Estate(**fields)  # type: ignore[arg-type]


def make_institution(
    policy: RecordedPolicy | None = POLICY, **overrides: object
) -> Institution:
    fields: dict[str, object] = {
        "institution_id": "inst-0001",
        "name": "Ellerby Trust Bank",
        "kind": InstitutionKind.BANK,
        # Ofcom drama range: this line cannot be dialled.
        "phone_e164": "+447700900101",
        "recorded_policy": policy,
    }
    fields.update(overrides)
    return Institution(**fields)  # type: ignore[arg-type]


def make_observations(**overrides: object) -> Observations:
    """A call that answered everything and agreed with the published policy.

    Starting from a clean capture means every test below names exactly the one
    thing it changed, which is the only way precedence is legible.
    """
    fields: dict[str, object] = {
        "reached": Reached.AGENT,
        "department_named": "Bereavement Team",
        "documents_named": (
            "certified copy of the death certificate",
            "grant of probate",
        ),
        "certified_copy_accepted": Ternary.YES,
        "direct_debits_action": DirectDebits.FROZEN,
        "reference_opened": "BRV-0001",
        "executor_only": Ternary.NO,
        "notification_accepted_by_phone": Ternary.YES,
        "evidence_quotes": ("A certified copy is fine.",),
        "turns": (),
    }
    fields.update(overrides)
    return Observations(**fields)  # type: ignore[arg-type]
