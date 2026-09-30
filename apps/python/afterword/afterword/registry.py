"""A fictional estate and the institutions that would have to be told.

Every number here comes from a range reserved for fiction -- Ofcom's
+44 7700 900xxx drama block and the North American 555-01xx block -- so nothing
in this repository can dial a real organisation. Every name is invented.

The six institutions exist to exercise the five outcomes honestly rather than
to flatter the system: exactly one of them ends in REQUIREMENTS_CAPTURED, two
end in a dispute, and one is never reached at all. That is roughly the shape of
a real afternoon of these calls.
"""

from __future__ import annotations

from datetime import date

from .models import (
    DirectDebits,
    Estate,
    Institution,
    InstitutionKind,
    PriorCall,
    RecordedPolicy,
    Requirement,
    Ternary,
)

#: The estate carries more than the agent is allowed to say. That is the point:
#: `disclosure.py` is tested against these values, not against a placeholder.
ESTATE = Estate(
    estate_id="est-0031",
    deceased_name="Elsie Marchetti",
    executor_name="Daniel Marchetti",
    reference="PRB-4471",
    executor_relationship="son",
    date_of_birth=date(1939, 2, 14),
    cause_of_death="bronchopneumonia after a fall at home",
    estimated_balance="11,204.60",
    notes="second account at Northgate opened under her maiden name Elsie Vaughan",
)

INSTITUTIONS: tuple[Institution, ...] = (
    Institution(
        institution_id="inst-01",
        name="Northgate Building Society",
        kind=InstitutionKind.BANK,
        phone_e164="+447700900161",
        # Publishes nothing about bereavement, which is why the call is the
        # only record the family will ever have of what it asked for.
        recorded_policy=None,
    ),
    Institution(
        institution_id="inst-02",
        name="Hartsmere Pension Trust",
        kind=InstitutionKind.PENSION,
        phone_e164="+447700900162",
        recorded_policy=RecordedPolicy(
            department="Bereavement Team",
            documents_needed=(
                "certified copy of the death certificate",
                "letter from the executor",
            ),
            certified_copy_accepted=Ternary.YES,
            direct_debits_action=DirectDebits.EXECUTOR_MUST_INSTRUCT,
            source="scheme member guide, 2026 edition",
        ),
    ),
    Institution(
        institution_id="inst-03",
        name="Calderwell Mutual Assurance",
        kind=InstitutionKind.INSURER,
        phone_e164="+447700900163",
        recorded_policy=RecordedPolicy(
            department="Claims Bereavement Desk",
            documents_needed=(
                "certified copy of the death certificate",
                "completed claim form",
            ),
            certified_copy_accepted=Ternary.YES,
            direct_debits_action=DirectDebits.CONTINUE,
            source="policy booklet section 9",
        ),
    ),
    Institution(
        institution_id="inst-04",
        name="Brightpath Energy",
        kind=InstitutionKind.UTILITY,
        phone_e164="+447700900164",
        recorded_policy=RecordedPolicy(
            department="Bereavement Support",
            documents_needed=("death certificate",),
            # The published page is silent on both. A policy that says nothing
            # cannot contradict anybody, and must not be read as a no.
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            source="help centre bereavement page",
        ),
    ),
    Institution(
        institution_id="inst-05",
        name="Larkspur Mobile",
        kind=InstitutionKind.MOBILE,
        phone_e164="+12025550171",
        recorded_policy=RecordedPolicy(
            department="Account Care",
            documents_needed=("death certificate",),
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            source="support article on a bereaved account",
        ),
    ),
    Institution(
        institution_id="inst-06",
        name="Fenwick Vale District Council",
        kind=InstitutionKind.COUNCIL,
        phone_e164="+447700900166",
        recorded_policy=RecordedPolicy(
            department="Registrar and Bereavement Services",
            documents_needed=("death certificate", "council tax account number"),
            certified_copy_accepted=Ternary.YES,
            direct_debits_action=DirectDebits.CANCELLED_ON_NOTIFICATION,
            source="council bereavement web page",
        ),
    ),
)

#: What earlier calls to the same institution captured. Hartsmere answered the
#: family once already, and answered differently from its own member guide.
#: Without this record the second call would silently overwrite the first.
PRIOR_CALLS: dict[str, tuple[PriorCall, ...]] = {
    "inst-02": (
        PriorCall(
            call_id="call-hartsmere-1",
            captured_on=date(2026, 8, 26),
            requirement=Requirement(
                department="Bereavement Team",
                documents_needed=(
                    "original death certificate",
                    "letter from the executor",
                ),
                certified_copy_accepted=Ternary.NO,
                direct_debits_action=DirectDebits.EXECUTOR_MUST_INSTRUCT,
                reference_opened="HPT-55120",
            ),
        ),
    ),
}

BY_ID = {institution.institution_id: institution for institution in INSTITUTIONS}


def get(institution_id: str) -> Institution:
    if institution_id not in BY_ID:
        raise KeyError(f"no institution {institution_id!r} on this estate")
    return BY_ID[institution_id]


def priors(institution_id: str) -> tuple[PriorCall, ...]:
    return PRIOR_CALLS.get(institution_id, ())
