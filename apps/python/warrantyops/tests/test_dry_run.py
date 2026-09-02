"""The default path places no calls, and every fixture produces what it declares."""

from __future__ import annotations

import json
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.config import ConfigRefusal, artifact_dir_refusals, find_repository_root, live_call_refusals, load_config
from warrantyops.providers.base import CallRequest
from warrantyops.providers.calle_client import attempt_transcript
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider, ZeroCallViolation
from warrantyops.workflow import CaseInput, run_case

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
PURPOSE = "warranty exception resolution"
SCENARIOS = sorted(path.stem for path in FIXTURE_DIR.glob("*.json"))


@pytest.fixture
def no_network(monkeypatch):
    """Make any outbound socket raise for the duration of the test."""

    def refuse(*args, **kwargs):  # pragma: no cover - the point is that it never runs
        raise AssertionError("the fake provider attempted to open a socket")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)


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


def case_for(scenario: str) -> CaseInput:
    return CaseInput(
        case_reference=f"CASE-{scenario}",
        asset_description="synthetic asset",
        failure_description="synthetic failure",
        prior_channel_outcome="synthetic portal exception",
        caller_organization="Example Field Services",
    )


# --- zero calls ------------------------------------------------------------

def test_a_full_run_completes_without_touching_the_network(no_network):
    provider = FakeCallProvider(scenario="case_a_success")
    fixture = provider.load()
    outcome = run_case(
        case_for("case_a_success"),
        authorization_for(fixture["recipient_e164"]),
        provider,
        now=NOW,
    )
    assert provider.calls_placed == 0
    assert provider.replays == 1
    assert outcome.terminal_state.value == "BUSINESS_RESOLVED"


def test_the_fake_provider_refuses_a_recipient_the_fixture_did_not_describe():
    provider = FakeCallProvider(scenario="case_a_success")
    with pytest.raises(ZeroCallViolation):
        provider.place_call(
            CallRequest(
                task="synthetic",
                recipient_e164="+14155550199",
                result_schema={},
                idempotency_key="warrantyops:test",
            )
        )


# --- gates in front of a live call ----------------------------------------

def test_dry_run_is_the_default_and_live_needs_every_gate():
    config = load_config(env={})
    assert config.dry_run is True
    refusals = live_call_refusals(config)
    assert ConfigRefusal.LIVE_NOT_ENABLED in refusals
    assert ConfigRefusal.MISSING_API_KEY in refusals


def test_a_credential_is_never_sent_to_an_unofficial_origin():
    config = load_config(
        env={
            "CALLE_LIVE_CALLS_ENABLED": "1",
            "CALLE_API_KEY": "synthetic-not-a-real-key",
            "CALLE_BASE_URL": "https://api.heycall-e.com.example",
            "WARRANTYOPS_ARTIFACT_DIR": "/tmp/warrantyops-artifacts",
        }
    )
    assert ConfigRefusal.UNOFFICIAL_ORIGIN in live_call_refusals(config)


def test_real_call_artifacts_may_not_be_written_inside_the_repository():
    repo_root = find_repository_root()
    assert repo_root is not None
    inside = repo_root / "apps" / "python" / "warrantyops" / "artifacts"
    assert ConfigRefusal.ARTIFACT_DIR_INSIDE_REPOSITORY in artifact_dir_refusals(inside)
    assert artifact_dir_refusals(Path("/tmp/warrantyops-artifacts")) == ()
    assert ConfigRefusal.ARTIFACT_DIR_MISSING in artifact_dir_refusals(None)


# --- reading a real API payload -------------------------------------------

def test_the_transcript_is_read_from_our_own_attempt_and_keeps_both_speakers():
    """Agent turns are kept: a confirmation binds to the read-back it answered."""

    payload = {
        "recipients": [
            {
                "phones": ["+14155550101"],
                "attempts": [
                    {
                        "phone": "+14155550101",
                        "transcript_turns": [
                            {"speaker": "user", "text": "Wrong recipient turn."}
                        ],
                    }
                ],
            },
            {
                "phones": ["+12025550142"],
                "attempts": [
                    {
                        "phone": "+12025550142",
                        "transcript_turns": [
                            {"offset_seconds": 0, "speaker": "bot", "text": "RMA 48171, correct?"},
                            {"offset_seconds": 4, "speaker": "user", "text": "Correct, RMA 48171."},
                            {"offset_seconds": 9, "speaker": "unknown", "text": ""},
                        ],
                    }
                ],
            },
        ]
    }
    transcript = attempt_transcript(payload, "+12025550142")
    assert [(turn.speaker, turn.text) for turn in transcript] == [
        ("bot", "RMA 48171, correct?"),
        ("user", "Correct, RMA 48171."),
    ]


# --- fixtures --------------------------------------------------------------

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
    outcome = run_case(
        case_for(scenario),
        authorization_for(fixture["recipient_e164"]),
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
    fixture = json.loads((FIXTURE_DIR / "case_c_ambiguous.json").read_text(encoding="utf-8"))
    assert fixture["structured_result"]["coverage_status"] == "UNKNOWN"
    assert fixture["expected"]["coverage_status"] == "UNKNOWN"


def test_no_fixture_invents_a_reference_it_was_not_given():
    for scenario in SCENARIOS:
        fixture = json.loads((FIXTURE_DIR / f"{scenario}.json").read_text(encoding="utf-8"))
        result = fixture.get("structured_result") or {}
        if result.get("authorization_reference_heard") is None:
            assert result.get("authorization_reference_confirmed") is None, scenario
            assert fixture["expected"]["authorization_reference"] is None, scenario


def test_every_fixture_transcript_uses_documented_speaker_labels():
    for scenario in SCENARIOS:
        fixture = json.loads((FIXTURE_DIR / f"{scenario}.json").read_text(encoding="utf-8"))
        for turn in fixture["transcript_turns"]:
            assert turn["speaker"] in {"bot", "user", "unknown"}, scenario
