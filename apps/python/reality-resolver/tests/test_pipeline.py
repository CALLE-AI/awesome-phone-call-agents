"""Direct, in-process tests for pipeline.resolve().

tests/test_resolver_e2e.py already drives the same pipeline through the
CLI by subprocess and asserts on stdout; these call resolve() directly,
which is what a non-CLI caller does. They exist to pin the contract that
interface down: what resolve() returns, what it raises, and in what order
it notifies an observer. Everything runs against fake_server.py - no test
here reaches a real provider or places a real call.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from compliance.use_cases import UnknownUseCaseError
from fake_server import SUBJECT_CANCELLED_PHONE, SUBJECT_VOICEMAIL_PHONE, FakeCalleServer
from pipeline import Observer, ResolutionRefused, ResolutionRequest, resolve

HERE = Path(__file__).resolve().parent.parent
ESCALATION = str(HERE / "cases" / "critical-service-escalation.json")
GHOST = str(HERE / "cases" / "ghost-appointment.json")

# Same instants tests/test_resolver_e2e.py uses, for the same reasons.
NEAR_DEADLINE_NOW = "2026-09-10T20:00:00Z"
FAR_FROM_DEADLINE_NOW = "2026-09-01T10:00:00Z"

AUTHORIZED = "+12025550123"  # the ghost case's call_phone
OTHER_NUMBER = "+15035550100"  # NANP reserved, different from the case's


def _at(text: str):
    from client import parse_utc_timestamp

    return parse_utc_timestamp(text)


def _request(case: str, base_url: str, **overrides) -> ResolutionRequest:
    fields = {
        "case_path": case,
        "base_url": base_url,
        "poll_interval_seconds": 0.01,
        "now_utc": _at(NEAR_DEADLINE_NOW),
    }
    fields.update(overrides)
    return ResolutionRequest(**fields)


class RecordingObserver(Observer):
    """Records the hook name of every notification, in order."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def __getattribute__(self, name: str):
        if name.startswith("on_"):
            object.__getattribute__(self, "calls").append(name)
            return lambda *args, **kwargs: None
        return object.__getattribute__(self, name)


def test_not_decision_critical_is_no_call_needed_and_never_reaches_compliance() -> None:
    with FakeCalleServer() as server:
        result = resolve(_request(ESCALATION, server.base_url, now_utc=_at(FAR_FROM_DEADLINE_NOW)))

        assert result.verdict is not None
        assert result.verdict.status == "NO_CALL_NEEDED"
        assert result.verdict.action == "NO_ACTION_REQUIRED"
        assert result.reasoning.decision_critical is False
        assert result.compliance is None  # the gate was never even consulted
        assert result.call_placed is False
        assert server.creates == 0


def test_unmapped_jurisdiction_blocks_before_any_call() -> None:
    with FakeCalleServer() as server:
        # Ofcom's reserved drama range: no jurisdiction chain resolves.
        result = resolve(_request(ESCALATION, server.base_url, phone_override="+442079460123"))

        assert result.verdict is not None
        assert result.verdict.status == "UNRESOLVED_CALL_BLOCKED"
        assert result.verdict.action == "RETRY_WHEN_PERMITTED"
        assert result.applicable_compliance is not None
        assert result.applicable_compliance.allowed is False
        assert result.next_legal_window is not None
        assert result.call_placed is False
        assert server.creates == 0


def test_dry_run_previews_the_real_request_body_and_reaches_no_verdict() -> None:
    """The dry-run boundary: a preview exists, nothing was sent, and there
    is deliberately no verdict yet - there is nothing to reconcile.
    """
    with FakeCalleServer() as server:
        result = resolve(_request(ESCALATION, server.base_url))

        assert result.call_preview is not None
        assert result.call_preview["result_schema"]["properties"]["subject_intent"]
        # The preview carries the real number; masking is the caller's job.
        assert result.call_preview["recipients"][0]["phones"] == ["+12025550187"]
        assert result.verdict is None
        assert result.call_placed is False
        assert server.creates == 0


def test_confirmed_by_human_resolves_to_the_cases_own_confirmed_action() -> None:
    with FakeCalleServer() as server:
        result = resolve(_request(ESCALATION, server.base_url, execute=True))

        assert result.verdict is not None
        assert result.verdict.status == "RESOLVED"
        assert result.verdict.action == "CONTINUE_DISPATCH"
        assert result.call_placed is True
        assert server.creates == 1


def test_cancelled_by_human_resolves_to_the_cases_own_cancelled_action() -> None:
    with FakeCalleServer() as server:
        result = resolve(
            _request(ESCALATION, server.base_url, execute=True, phone_override=SUBJECT_CANCELLED_PHONE)
        )

        assert result.verdict is not None
        assert result.verdict.status == "RESOLVED_ALT"
        assert result.verdict.action == "REASSIGN_TECHNICIAN"


def test_voicemail_is_human_review_and_never_the_cancelled_action() -> None:
    """The absolute rule, at the pipeline boundary rather than through
    stdout: an unresolved call must never surface the if_cancelled action
    to any caller, CLI or otherwise.
    """
    with FakeCalleServer() as server:
        result = resolve(
            _request(ESCALATION, server.base_url, execute=True, phone_override=SUBJECT_VOICEMAIL_PHONE)
        )

        assert result.verdict is not None
        assert result.verdict.status == "UNRESOLVED_AMBIGUOUS"
        assert result.verdict.action == "HUMAN_REVIEW"
        assert result.verdict.action != result.case.decision_options["if_cancelled"]


def test_resolution_keeps_the_providers_raw_response_not_a_redacted_copy() -> None:
    """Resolution.call must hold what CALL-E actually returned, for the
    same reason reconcile() is given the raw structured_result: redaction
    is a rendering concern, and a caller that reasons about a masked
    number or a truncated field is reasoning about the wrong thing.
    """
    with FakeCalleServer() as server:
        result = resolve(_request(ESCALATION, server.base_url, execute=True))

        assert result.call is not None
        assert result.call["structured_result"]["subject_intent"] == "confirmed"
        phones = result.call["recipients"][0]["phones"]
        assert phones == ["+12025550187"], "the raw response must not arrive pre-masked"


# --- refusals -------------------------------------------------------
#
# Each of these stops before the evidence engine runs, so server.creates
# stays 0 - the fake server proves nothing was sent.


def test_allow_live_without_authorize_destination_is_refused() -> None:
    with FakeCalleServer() as server:
        with pytest.raises(ResolutionRefused, match="requires --authorize-destination"):
            resolve(_request(GHOST, server.base_url, execute=True, allow_live=True, now_utc=None))
        assert server.creates == 0


def test_allow_live_with_a_different_destination_is_refused() -> None:
    with FakeCalleServer() as server:
        with pytest.raises(ResolutionRefused, match="does not match the call's resolved destination"):
            resolve(
                _request(
                    GHOST,
                    server.base_url,
                    execute=True,
                    allow_live=True,
                    authorize_destination=OTHER_NUMBER,
                    now_utc=None,
                )
            )
        assert server.creates == 0


def test_phone_override_means_only_the_final_number_can_be_authorized() -> None:
    """Authorizing the case file's original number must not authorize an
    overridden call - only the number actually about to be dialled counts.
    """
    with FakeCalleServer() as server:
        with pytest.raises(ResolutionRefused, match="does not match"):
            resolve(
                _request(
                    GHOST,
                    server.base_url,
                    execute=True,
                    allow_live=True,
                    phone_override=OTHER_NUMBER,
                    authorize_destination=AUTHORIZED,
                    now_utc=None,
                )
            )
        assert server.creates == 0


def test_allow_live_refuses_an_overridden_now() -> None:
    """The interlock fires before the case file is even read."""
    with FakeCalleServer() as server:
        with pytest.raises(ResolutionRefused, match="cannot be combined with --allow-live"):
            resolve(
                _request(
                    GHOST,
                    server.base_url,
                    allow_live=True,
                    authorize_destination=AUTHORIZED,
                    now_utc=_at(NEAR_DEADLINE_NOW),
                )
            )
        assert server.creates == 0


def test_unknown_use_case_fails_closed_before_any_call(tmp_path: Path) -> None:
    case = json.loads(Path(GHOST).read_text(encoding="utf-8"))
    case["use_case"] = "commercial_outbound"
    unmapped = tmp_path / "unmapped.json"
    unmapped.write_text(json.dumps(case), encoding="utf-8")

    with FakeCalleServer() as server:
        with pytest.raises(UnknownUseCaseError):
            resolve(_request(str(unmapped), server.base_url, execute=True))
        assert server.creates == 0


# --- observer contract ----------------------------------------------


def test_observer_is_notified_in_pipeline_order() -> None:
    """The hook sequence is the streaming contract every interface relies
    on, so it is pinned here rather than left to whichever caller happens
    to notice it changed.
    """
    with FakeCalleServer() as server:
        observer = RecordingObserver()
        resolve(_request(ESCALATION, server.base_url, execute=True), observer)

        assert observer.calls[:5] == [
            "on_start",
            "on_reasoning",
            "on_compliance_checks",
            "on_use_case_filter",
            "on_call_preview",
        ]
        assert observer.calls[-1] == "on_verdict"
        assert "on_call_created" in observer.calls
        assert "on_call_completed" in observer.calls
        assert "on_dry_run" not in observer.calls
        assert "on_blocked" not in observer.calls


def test_no_call_needed_notifies_only_the_stages_it_reached() -> None:
    with FakeCalleServer() as server:
        observer = RecordingObserver()
        resolve(_request(ESCALATION, server.base_url, now_utc=_at(FAR_FROM_DEADLINE_NOW)), observer)

        assert observer.calls == ["on_start", "on_reasoning", "on_verdict"]


def test_resolve_works_without_an_observer_at_all() -> None:
    """The default no-op observer is what a non-streaming caller uses."""
    with FakeCalleServer() as server:
        result = resolve(_request(ESCALATION, server.base_url, execute=True))

        assert result.verdict is not None
        assert result.verdict.status == "RESOLVED"
