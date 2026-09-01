"""Every fixture states the outcome it expects, and the code has to produce it."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.workflow import CaseInput, run_case

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
SCENARIOS = sorted(path.stem for path in FIXTURE_DIR.glob("*.json"))


def test_the_expected_scenarios_exist():
    assert SCENARIOS == [
        "case_a_success",
        "case_b_documentation_required",
        "case_c_ambiguous",
        "case_d_identifier_readback",
        "case_e_no_answer",
    ]


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_fixture_produces_the_outcome_it_declares(scenario):
    provider = FakeCallProvider(scenario=scenario)
    fixture = provider.load()
    expected = fixture["expected"]
    authorization = CallAuthorization(
        recipient_e164=fixture["recipient_e164"],
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose="warranty exception resolution",
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )
    outcome = run_case(
        CaseInput(
            case_reference=f"CASE-{scenario}",
            asset_description="synthetic asset",
            failure_description="synthetic failure",
            prior_channel_outcome="synthetic portal exception",
            caller_organization="Example Field Services",
        ),
        authorization,
        provider,
        now=NOW,
    )
    assert outcome.terminal_state.value == expected["terminal_state"]
    assert outcome.business.coverage_status.value == expected["coverage_status"]
    assert outcome.business.resolution_status.value == expected["resolution_status"]
    assert outcome.business.authorization_reference == expected["authorization_reference"]
    if expected["identifier_state"] is None:
        assert outcome.identifier is None
    else:
        assert outcome.identifier is not None
        assert outcome.identifier.state.value == expected["identifier_state"]
        assert outcome.identifier.corrected == expected["identifier_corrected"]
    assert provider.calls_placed == 0


def test_the_ambiguous_case_never_becomes_covered():
    fixture = json.loads(
        (FIXTURE_DIR / "case_c_ambiguous.json").read_text(encoding="utf-8")
    )
    assert fixture["structured_result"]["coverage_status"] == "UNKNOWN"
    assert fixture["expected"]["coverage_status"] == "UNKNOWN"


def test_no_fixture_invents_a_reference_it_was_not_given():
    for scenario in SCENARIOS:
        fixture = json.loads(
            (FIXTURE_DIR / f"{scenario}.json").read_text(encoding="utf-8")
        )
        result = fixture.get("structured_result") or {}
        heard = result.get("authorization_reference_heard")
        confirmed = result.get("authorization_reference_confirmed")
        if heard is None:
            assert confirmed is None, scenario
            assert fixture["expected"]["authorization_reference"] is None, scenario
