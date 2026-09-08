"""Tests for compliance/use_cases.py - the use-case applicability filter.

Constructs PreCallDecision/CheckResult values directly rather than going
through run_precall_checks: this module doesn't care which jurisdiction
a check came from, only its name, so a synthetic decision is enough to
prove the filtering rule in isolation.
"""

from __future__ import annotations

import pytest

from compliance.models import CheckResult, PreCallDecision
from compliance.use_cases import UnknownUseCaseError, apply_use_case

COMMERCIAL_CHECKS_FAILING = (
    CheckResult("us_federal_calling_window", False, "outside window"),
    CheckResult("us_federal_consent", False, "PEWC not documented"),
    CheckResult("us_federal_dnc_scrub", False, "DNC scrub not confirmed"),
    CheckResult("us_oregon_solicitation_cap", False, "cap exceeded"),
)
GENERIC_CHECKS_PASSING = (
    CheckResult("us_federal_disclosure_script", True, "discloses AI"),
    CheckResult("us_federal_revocation", True, "no revocation on record"),
)


def test_appointment_confirmation_exempts_commercial_solicitation_checks() -> None:
    decision = PreCallDecision(
        allowed=False,
        jurisdiction_chain=("us_federal", "us_oregon"),
        results=COMMERCIAL_CHECKS_FAILING + GENERIC_CHECKS_PASSING,
    )
    filtered = apply_use_case(decision, "appointment_confirmation")

    assert filtered.allowed is True
    filtered_names = {r.check_name for r in filtered.results}
    assert filtered_names == {"us_federal_disclosure_script", "us_federal_revocation"}


def test_appointment_confirmation_still_blocks_on_revocation() -> None:
    decision = PreCallDecision(
        allowed=False,
        jurisdiction_chain=("us_federal",),
        results=COMMERCIAL_CHECKS_FAILING
        + (
            CheckResult("us_federal_disclosure_script", True, "discloses AI"),
            CheckResult("us_federal_revocation", False, "do_not_call_requested is set"),
        ),
    )
    filtered = apply_use_case(decision, "appointment_confirmation")

    assert filtered.allowed is False
    assert filtered.blocking_reasons == ("do_not_call_requested is set",)


def test_appointment_confirmation_still_blocks_on_disclosure_failure() -> None:
    decision = PreCallDecision(
        allowed=False,
        jurisdiction_chain=("us_federal",),
        results=COMMERCIAL_CHECKS_FAILING
        + (
            CheckResult("us_federal_disclosure_script", False, "missing required elements"),
            CheckResult("us_federal_revocation", True, "no revocation on record"),
        ),
    )
    filtered = apply_use_case(decision, "appointment_confirmation")

    assert filtered.allowed is False
    assert filtered.blocking_reasons == ("missing required elements",)


def test_unknown_use_case_fails_closed() -> None:
    decision = PreCallDecision(allowed=True, jurisdiction_chain=("us_federal",), results=GENERIC_CHECKS_PASSING)
    with pytest.raises(UnknownUseCaseError):
        apply_use_case(decision, "commercial_outbound")


def test_all_checks_exempted_is_not_vacuously_allowed() -> None:
    """If every check a jurisdiction happens to return is exempt for this
    use case, allowed must stay False, not become vacuously True - same
    fail-closed-on-empty principle as dispatcher.run_precall_checks.
    """
    decision = PreCallDecision(
        allowed=False, jurisdiction_chain=("us_oregon",), results=(CheckResult("us_oregon_calling_window", True, "in window"),)
    )
    filtered = apply_use_case(decision, "appointment_confirmation")

    assert filtered.results == ()
    assert filtered.allowed is False
