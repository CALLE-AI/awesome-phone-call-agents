"""Fictional seed data for a no-call demonstration.

Every identifier here is invented. Phone numbers use the NANP 555-01XX range
reserved for fiction, and the national provider identifier is the published test
value, not a real registration.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Set, Tuple

from .client import CalleError, load_fixture
from .models import Claim, Ledger, Payer, Practice
from .verify import normalize_claim_number

PRACTICE = Practice(
    id="prac_lakeshore",
    name="Lakeshore Family Medicine",
    npi="1234567893",
    tin_last4="4419",
    timezone="America/New_York",
)

PAYERS: List[Payer] = [
    Payer(
        id="pay_meridian",
        name="Meridian Health Plan",
        line_of_business="Commercial PPO",
        phone="+12125550142",
        region="US",
        timezone="America/New_York",
        claims_per_call_cap=3,
        call_window="08:00-17:00",
        ivr_path=["1 for claim status", "enter NPI", "hold for representative"],
        ivr_path_recorded_at="2026-09-02T14:10:00Z",
    ),
    Payer(
        id="pay_cascade",
        name="Cascade Mutual",
        line_of_business="Medicare Advantage",
        phone="+13125550188",
        region="US",
        timezone="America/Chicago",
        claims_per_call_cap=2,
        call_window="08:00-16:30",
    ),
]

# patient_ref -> vault record. Fields beyond the envelope are present on purpose:
# they are what the never-disclose rule and the redactor are tested against.
VAULT: Dict[str, Dict[str, str]] = {
    "pt_0001": {
        "member_id": "W884213097",
        "date_of_birth": "1984-03-11",
        "patient_first_name": "Renata",
        "patient_last_name": "Alvarez",
        "ssn_last4": "4417",
        "medical_record_number": "MRN-55219",
        "address_line1": "418 Kestrel Lane",
        "phone": "+12125550177",
        "email": "renata.alvarez@example.com",
    },
    "pt_0002": {
        "member_id": "H551908324",
        "date_of_birth": "1972-11-02",
        "patient_first_name": "Desmond",
        "patient_last_name": "Okafor",
        "ssn_last4": "8830",
        "medical_record_number": "MRN-55284",
    },
    "pt_0003": {
        "member_id": "T203877651",
        "date_of_birth": "1995-06-24",
        "patient_first_name": "Ingrid",
        "patient_last_name": "Sorensen",
        "ssn_last4": "2210",
    },
}


def _claim(
    index: int,
    payer_id: str,
    patient_ref: str,
    workflow: str,
    number: str,
    dos: str,
    billed: float,
    deadline_days: int,
    procedure: str = "",
) -> Claim:
    deadline = date.today() + timedelta(days=deadline_days)
    return Claim(
        id="clm_%04d" % index,
        practice_id=PRACTICE.id,
        payer_id=payer_id,
        patient_ref=patient_ref,
        workflow=workflow,
        claim_number=number,
        date_of_service=dos,
        billed_amount=billed,
        filing_deadline=deadline.isoformat(),
        procedure_code=procedure,
    )


def claims() -> List[Claim]:
    return [
        _claim(1, "pay_meridian", "pt_0001", "claim_status", "CLM-2026-004417", "2026-07-29", 312.00, 138),
        _claim(2, "pay_meridian", "pt_0001", "claim_status", "CLM-2026-004612", "2026-08-04", 486.50, 144),
        _claim(3, "pay_meridian", "pt_0001", "claim_status", "CLM-2026-004733", "2026-08-19", 205.75, 159),
        _claim(4, "pay_meridian", "pt_0002", "claim_status", "CLM-2026-004818", "2026-08-22", 178.00, 162),
        _claim(5, "pay_meridian", "pt_0001", "denial_reason", "CLM-2026-004612", "2026-08-04", 486.50, 11),
        _claim(6, "pay_meridian", "pt_0001", "eligibility", "CLM-2026-004901", "2026-09-03", 240.00, 174),
        _claim(7, "pay_meridian", "pt_0003", "prior_auth_status", "PA-2026-11832", "2026-09-15", 1420.00, 96, "72148"),
        _claim(8, "pay_cascade", "pt_0002", "claim_status", "CLM-2026-005120", "2026-08-11", 96.40, 151),
        _claim(9, "pay_cascade", "pt_0003", "claim_status", "CLM-2026-005204", "2026-08-27", 640.00, 167),
        _claim(10, "pay_cascade", "pt_0002", "denial_reason", "CLM-2026-005120", "2026-08-11", 96.40, 21),
    ]


def build() -> Tuple[Ledger, Dict[str, Dict[str, str]]]:
    ledger = Ledger(practices=[PRACTICE], payers=list(PAYERS), claims=claims())
    return ledger, VAULT


# ---------------------------------------------------------------------------
# Which recording a bundle replays in fixture mode.
# ---------------------------------------------------------------------------
# A recording only means something replayed against the claims it was made for.
# Playing Meridian's transcript at a Cascade bundle returns an answer about
# claims nobody asked about, so every claim on the call comes back ungrounded
# and the call is marked unusable. That looks like the evidence guard firing
# when it is really the wrong tape in the machine, and a demonstration whose
# first call fails for a bookkeeping reason teaches the reader nothing.
#
# So the scenario is chosen by claim number: among the recordings for this
# workflow, the one that covers the most of this bundle's claims wins.
#
# The adversarial fixtures are deliberately absent here. ``ungrounded_evidence``
# and ``schema_violation`` carry the same claim numbers as ``claim_status_paid``
# and would match just as well, but they exist to be asked for by name with
# ``--scenario``. A guardrail should fire because someone aimed it, not because
# a lookup happened to land there.

CANONICAL_SCENARIOS: Dict[str, Tuple[str, ...]] = {
    "claim_status": ("claim_status_paid", "cascade_claim_status", "claim_status_in_process"),
    "denial_reason": ("denial_reason_co97", "cascade_denial_reason"),
    "prior_auth_status": ("prior_auth_pending",),
    "eligibility": ("eligibility_active",),
}

DEFAULT_SCENARIOS: Dict[str, str] = {
    workflow: scenarios[0] for workflow, scenarios in CANONICAL_SCENARIOS.items()
}


def _fixture_claim_numbers(fixture: Dict[str, object]) -> Set[str]:
    result = fixture.get("structured_result")
    if not isinstance(result, dict):
        return set()
    numbers = set()
    for entry in result.get("claims") or []:
        if isinstance(entry, dict):
            numbers.add(normalize_claim_number(str(entry.get("claim_number", ""))))
    numbers.discard("")
    return numbers


def scenario_for(
    fixtures_dir: str,
    workflow: str,
    claim_numbers: Iterable[str],
    explicit: Optional[str] = None,
) -> Optional[str]:
    """The recording to replay for this bundle.

    ``explicit`` is whatever the operator passed to ``--scenario`` and always
    wins, including the adversarial fixtures. Otherwise the canonical recording
    covering the most of these claims is chosen, falling back to the workflow
    default when none of them mentions this bundle at all.
    """
    if explicit:
        return explicit
    wanted = {normalize_claim_number(number) for number in claim_numbers}
    wanted.discard("")
    best: Optional[str] = None
    best_covered = 0
    for name in CANONICAL_SCENARIOS.get(workflow, ()):
        try:
            fixture = load_fixture(fixtures_dir, name)
        except CalleError:
            continue
        covered = len(wanted & _fixture_claim_numbers(fixture))
        if covered > best_covered:
            best, best_covered = name, covered
    return best or DEFAULT_SCENARIOS.get(workflow)
