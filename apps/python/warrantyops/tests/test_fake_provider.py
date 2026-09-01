"""The default path places no calls, and that is proved rather than asserted."""

from __future__ import annotations

import socket
from datetime import datetime, timedelta, timezone

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.config import ConfigRefusal, live_call_refusals, load_config
from warrantyops.providers.fake import FakeCallProvider
from warrantyops.workflow import CaseInput, run_case

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
PURPOSE = "warranty exception resolution"


@pytest.fixture
def no_network(monkeypatch):
    """Make any outbound socket raise for the duration of the test."""

    def refuse(*args, **kwargs):  # pragma: no cover - the point is that it never runs
        raise AssertionError("the fake provider attempted to open a socket")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    return refuse


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


def test_a_full_run_completes_without_touching_the_network(no_network):
    provider = FakeCallProvider(scenario="case_a_success")
    fixture = provider.load()
    authorization = authorization_for(fixture["recipient_e164"])
    outcome = run_case(
        CaseInput(
            case_reference="CASE-A",
            asset_description="synthetic asset",
            failure_description="synthetic failure",
            prior_channel_outcome="synthetic portal exception",
            caller_organization="Example Field Services",
        ),
        authorization,
        provider,
        now=NOW,
    )
    assert provider.calls_placed == 0
    assert provider.replays == 1
    assert outcome.terminal_state.value == "BUSINESS_RESOLVED"


def test_the_fake_provider_refuses_a_recipient_the_fixture_did_not_describe():
    provider = FakeCallProvider(scenario="case_a_success")
    from warrantyops.providers.fake import ZeroCallViolation
    from warrantyops.providers.base import CallRequest

    with pytest.raises(ZeroCallViolation):
        provider.place_call(
            CallRequest(
                task="synthetic",
                recipient_e164="+14155550199",
                result_schema={},
                idempotency_key="warrantyops:test",
            )
        )


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
    from pathlib import Path

    from warrantyops.config import artifact_dir_refusals, find_repository_root

    repo_root = find_repository_root()
    assert repo_root is not None
    inside = repo_root / "apps" / "python" / "warrantyops" / "artifacts"
    assert ConfigRefusal.ARTIFACT_DIR_INSIDE_REPOSITORY in artifact_dir_refusals(inside)
    assert artifact_dir_refusals(Path("/tmp/warrantyops-artifacts")) == ()
    assert ConfigRefusal.ARTIFACT_DIR_MISSING in artifact_dir_refusals(None)


def test_counterparty_turns_are_read_from_our_own_attempt():
    """The agent's own read-back must never ground its own confirmation."""

    from warrantyops.providers.calle_client import counterparty_turns

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
                            {"speaker": "bot", "text": "Just to confirm, RMA 48171?"},
                            {"speaker": "user", "text": "Correct, that is RMA 48171."},
                            {"speaker": "unknown", "text": ""},
                        ],
                    }
                ],
            },
        ]
    }
    assert counterparty_turns(payload, "+12025550142") == (
        "Correct, that is RMA 48171.",
    )
