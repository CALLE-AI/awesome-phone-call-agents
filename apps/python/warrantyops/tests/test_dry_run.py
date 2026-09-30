"""The default path places no calls, and live needs every gate turned."""

from __future__ import annotations

import socket
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.config import (
    ConfigRefusal,
    artifact_dir_refusals,
    find_repository_root,
    live_call_refusals,
    load_config,
)
from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.providers.base import CallRequest, recipient_routing
from warrantyops.providers.calle_client import attempt_transcript
from warrantyops.providers.fake import FakeCallProvider, ZeroCallViolation
from warrantyops.source import InMemorySourceStore
from warrantyops.workflow import run_exception

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
ON = date(2026, 9, 1)
PURPOSE = "warranty claim exception follow-up"


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


# --- zero calls ------------------------------------------------------------


def test_a_full_run_completes_without_touching_the_network(no_network):
    provider = FakeCallProvider(scenario="case_a_useful_resolution")
    fixture = provider.load()
    claim = source_claim_from_dict(fixture["envelope"])
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    run = run_exception(
        claim,
        authorization_for(fixture["recipient_e164"]),
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        on=ON,
    )
    assert provider.calls_placed == 0
    assert provider.replays == 1
    assert run.refusal is None
    assert run.outcome.terminal_state.value == "INFORMATION_OBTAINED"


def test_the_fake_provider_refuses_a_recipient_the_fixture_did_not_describe():
    provider = FakeCallProvider(scenario="case_a_useful_resolution")
    with pytest.raises(ZeroCallViolation):
        provider.place_call(
            CallRequest(
                task="synthetic",
                recipient_e164="+14155550199",
                result_schema={},
                idempotency_key="warrantyops:test",
                locale=recipient_routing("+14155550199")[1],
                region=recipient_routing("+14155550199")[0],
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
                            {"offset_seconds": 0, "speaker": "bot", "text": "Case 90210, correct?"},
                            {
                                "offset_seconds": 4,
                                "speaker": "user",
                                "text": "Correct, case 90210.",
                            },
                            {"offset_seconds": 9, "speaker": "unknown", "text": ""},
                        ],
                    }
                ],
            },
        ]
    }
    transcript = attempt_transcript(payload, "+12025550142")
    assert [(turn.speaker, turn.text) for turn in transcript] == [
        ("bot", "Case 90210, correct?"),
        ("user", "Correct, case 90210."),
    ]


# --- unknown scenarios fail loudly ---------------------------------------------


def test_an_unknown_scenario_names_what_is_available():
    with pytest.raises(FileNotFoundError, match="case_a_useful_resolution"):
        FakeCallProvider(scenario="no_such_case").load()
