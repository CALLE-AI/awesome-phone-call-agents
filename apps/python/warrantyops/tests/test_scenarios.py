"""The six local scenarios, end to end through the fake provider.

Every scenario declares what it expects in its fixture; these tests run the
real workflow (gates, provider seam, outcome derivation, review, write-back)
against each one and assert the declared result. The fake provider places
zero real calls in all of them, and the refusal scenarios prove the provider
is never invoked at all.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.cli import run_scenario
from warrantyops.envelope import source_claim_from_dict, validate_source_claim
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import run_exception
from warrantyops.writeback import InMemoryNoteLedger, WriteBackRefusal, write_back

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"

SCENARIOS = sorted(path.stem for path in FIXTURE_DIR.glob("*.json"))


def fixtures() -> dict[str, dict]:
    return {
        scenario: json.loads((FIXTURE_DIR / f"{scenario}.json").read_text(encoding="utf-8"))
        for scenario in SCENARIOS
    }


def authorization_for(number: str) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=number,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


# --- the set of scenarios --------------------------------------------------


def test_the_six_mandated_scenarios_exist():
    assert SCENARIOS == [
        "case_a_useful_resolution",
        "case_b_source_sufficient",
        "case_c_missing_documents",
        "case_d_corrected_reference",
        "case_e_no_result",
        "case_f_source_changed",
    ]


def test_every_fixture_envelope_is_a_valid_snapshot():
    for scenario, fixture in fixtures().items():
        claim = source_claim_from_dict(fixture["envelope"])
        decision = validate_source_claim(claim, on=ON)
        assert decision.ok, (scenario, decision.to_dict())


def test_every_fixture_transcript_uses_documented_speaker_labels():
    for scenario, fixture in fixtures().items():
        for turn in fixture["transcript_turns"]:
            assert turn["speaker"] in {"bot", "user", "unknown"}, scenario


def test_no_fixture_invents_a_reference_it_was_not_given():
    for scenario, fixture in fixtures().items():
        result = fixture.get("structured_result") or {}
        if result.get("reference_heard") is None:
            assert result.get("reference_confirmed") is None, scenario
            assert fixture["expected"]["confirmed_reference"] is None, scenario


# --- end to end ------------------------------------------------------------


def exercise(scenario: str, ledger=None):
    fixture = fixtures()[scenario]
    claim = source_claim_from_dict(fixture["envelope"])
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    provider = FakeCallProvider(scenario=scenario)
    run = run_exception(
        claim,
        authorization_for(fixture["recipient_e164"]),
        provider,
        version_reader=store,
        attempt_ledger=ledger if ledger is not None else InMemoryAttemptLedger(),
        now=NOW,
        on=ON,
        allowlist=frozenset({fixture["recipient_e164"]}),
    )
    return fixture, claim, store, provider, run


def review_stage(fixture, claim, store, run, outcome):
    packet = prepare_review(outcome, fixture["recipient_e164"])
    source_change = fixture.get("source_change") or {}
    if source_change.get("before_writeback_version"):
        store.set_version(
            claim.source_platform,
            claim.source_claim_id,
            source_change["before_writeback_version"],
        )
    decision = ReviewRecord(
        decision=ReviewDecision.APPROVE,
        reviewer="test-reviewer",
        decided_at=NOW,
        review_id=packet.review_id,
        packet_sha256=packet.packet_sha256,
        operator_id="operator-test",
    )
    return write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        decision,
        outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=outcome.transport.call_id,
        written_at=NOW,
    )


def test_case_a_useful_resolution():
    fixture, claim, store, provider, run = exercise("case_a_useful_resolution")
    expected = fixture["expected"]
    assert run.refusal is None
    assert run.outcome.terminal_state.value == expected["terminal_state"]
    assert run.outcome.business.claim_status.value == expected["claim_status"]
    assert run.outcome.business.confirmed_reference.to_dict() == expected["confirmed_reference"]
    assert provider.calls_placed == 0
    assert provider.replays == expected["provider_replays"]
    result = review_stage(fixture, claim, store, run, run.outcome)
    assert not isinstance(result, WriteBackRefusal)
    assert result.note["confirmed_reference"] == expected["confirmed_reference"]
    assert result.note["evidence_pointer"] == "call_synthetic_case_a"


def test_case_b_source_sufficient_never_reaches_the_provider():
    fixture, claim, store, provider, run = exercise("case_b_source_sufficient")
    expected = fixture["expected"]
    assert run.outcome is None
    assert run.refusal is not None
    assert run.refusal.gate.value == expected["refusal"]["gate"]
    assert run.refusal.reasons == tuple(expected["refusal"]["reasons"])
    assert provider.replays == 0
    assert provider.calls_placed == 0


def test_case_c_missing_documents_is_action_required_not_a_status():
    fixture, claim, store, provider, run = exercise("case_c_missing_documents")
    expected = fixture["expected"]
    assert run.refusal is None
    assert run.outcome.terminal_state.value == expected["terminal_state"]
    assert run.outcome.business.claim_status.value == "UNKNOWN"
    assert run.outcome.business.required_documents == (
        "copy of the installation invoice",
        "photograph of the data plate",
    )
    assert provider.calls_placed == 0
    result = review_stage(fixture, claim, store, run, run.outcome)
    assert not isinstance(result, WriteBackRefusal)


def test_case_d_corrected_reference_asserts_only_the_corrected_value():
    fixture, claim, store, provider, run = exercise("case_d_corrected_reference")
    expected = fixture["expected"]
    assert run.refusal is None
    identifier = run.outcome.identifier
    assert identifier.state.value == expected["identifier_state"]
    assert identifier.heard_value == "CASE48171"
    assert identifier.value == "CASE48178"
    assert run.outcome.business.confirmed_reference.to_dict() == expected["confirmed_reference"]
    assert provider.calls_placed == 0
    result = review_stage(fixture, claim, store, run, run.outcome)
    assert not isinstance(result, WriteBackRefusal)
    assert result.note["confirmed_reference"]["value"] == "CASE48178"


def test_case_e_no_result_writes_nothing():
    fixture, claim, store, provider, run = exercise("case_e_no_result")
    expected = fixture["expected"]
    assert run.refusal is None
    assert run.outcome.terminal_state.value == expected["terminal_state"]
    assert run.outcome.business.claim_status.value == "UNKNOWN"
    assert run.outcome.identifier is None
    assert provider.calls_placed == 0
    result = review_stage(fixture, claim, store, run, run.outcome)
    assert result is WriteBackRefusal.NO_BUSINESS_RESULT


def test_case_f_source_changed_refuses_the_write_back_without_a_second_call():
    fixture, claim, store, provider, run = exercise("case_f_source_changed")
    expected = fixture["expected"]
    assert run.refusal is None
    assert run.outcome.terminal_state.value == expected["terminal_state"]
    result = review_stage(fixture, claim, store, run, run.outcome)
    assert result is WriteBackRefusal.SOURCE_CHANGED
    assert provider.calls_placed == 0
    assert provider.replays == 1  # no duplicate call after the refusal


# --- CLI surface -----------------------------------------------------------


def test_the_cli_withholds_write_back_until_a_human_approves():
    report = run_scenario("case_a_useful_resolution", FIXTURE_DIR, approve=False)
    assert report["write_back"] == "WITHHELD_PENDING_REVIEW"
    assert report["real_calls_placed"] == 0
    assert report["review"]["recipient"] == "+12*******42"


def test_the_cli_approved_path_produces_a_receipt():
    report = run_scenario("case_a_useful_resolution", FIXTURE_DIR, approve=True)
    assert report["terminal_state"] == "INFORMATION_OBTAINED"
    assert isinstance(report["write_back"], dict)
    assert report["write_back"]["note_id"]
    assert report["real_calls_placed"] == 0


def test_the_cli_refusal_scenario_reports_the_gate():
    report = run_scenario("case_b_source_sufficient", FIXTURE_DIR, approve=True)
    assert report["refused"] is True
    assert report["gate"] == "RESIDUAL_NECESSITY"
    assert report["reasons"] == ["SOURCE_ALREADY_ANSWERS"]
    assert report["write_back"] == "NONE"
    assert report["real_calls_placed"] == 0
    assert report["provider_replays"] == 0


def test_the_cli_ledger_db_option_suppresses_a_second_invocation(tmp_path):
    """The explicit user-state ledger survives the process boundary."""

    database = tmp_path / "attempts.sqlite"
    first = run_scenario(
        "case_a_useful_resolution", FIXTURE_DIR, approve=False, ledger_db=database
    )
    assert first["provider_replays"] == 1
    assert first["real_calls_placed"] == 0
    second = run_scenario(
        "case_a_useful_resolution", FIXTURE_DIR, approve=False, ledger_db=database
    )
    assert second["refused"] is True
    assert second["gate"] == "ATTEMPT_LEDGER"
    assert second["reasons"] == ["DUPLICATE_CALL_SUPPRESSED"]
    assert second["provider_replays"] == 0
    assert second["real_calls_placed"] == 0
