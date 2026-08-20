"""Tests for the reconciliation state machine.

These run with no credentials and no network: every observation comes from a
recorded fixture or is constructed inline.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest

from clients import ReplayClient
from mapping import OutcomeMap
from poller import PollingPolicy, poll
from reconciler import reconcile
from record import OUTCOMES, Observation, mask_phone

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURES = sorted(p.name for p in FIXTURE_DIR.glob("*.json"))


@pytest.fixture(scope="module")
def outcome_map() -> OutcomeMap:
    return OutcomeMap.load()


class StepClock:
    """Advances one second per read so budgets trip without real sleeping."""

    def __init__(self, step: float = 1.0) -> None:
        self._now = 0.0
        self._step = step

    def __call__(self) -> float:
        self._now += self._step
        return self._now


def run_fixture(name: str, outcome_map: OutcomeMap, policy: PollingPolicy | None = None):
    client = ReplayClient.from_fixture(FIXTURE_DIR / name)
    result = poll(
        "call_test_reference",
        client,
        outcome_map,
        policy or PollingPolicy(max_wall_clock_seconds=60, max_observations=8),
        clock=StepClock(),
        sleep=lambda _s: None,
        timestamp=lambda: "2026-08-06T10:00:00+00:00",
        jitter=lambda: 0.5,
    )
    return reconcile(
        "call_test_reference",
        result.observations,
        outcome_map,
        recipient_phone=result.recipient_phone,
        exhausted=result.exhausted,
        exhaustion_reason=result.exhaustion_reason,
    )


@pytest.mark.parametrize("name", FIXTURES)
def test_fixture_produces_its_declared_expectation(name: str, outcome_map: OutcomeMap) -> None:
    """Each fixture states the outcome it expects; the layer must agree."""
    declared = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))["expected"]
    record = run_fixture(name, outcome_map)

    assert record.outcome == declared["outcome"], f"{name}: {record.evidence.decision}"
    if "reason" in declared:
        assert record.reason == declared["reason"]
    if "entry_id" in declared:
        assert record.mapping.entry_id == declared["entry_id"]
        assert record.mapping.matched is True


@pytest.mark.parametrize("name", FIXTURES)
def test_every_fixture_yields_exactly_one_known_outcome(name: str, outcome_map: OutcomeMap) -> None:
    record = run_fixture(name, outcome_map)
    assert record.outcome in OUTCOMES
    assert isinstance(record.outcome, str)


@pytest.mark.parametrize("name", FIXTURES)
def test_raw_last_payload_round_trips_unchanged(name: str, outcome_map: OutcomeMap) -> None:
    """Raw fidelity: the upstream payload survives verbatim, unknown fields included."""
    fixture = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    payload_steps = [step["payload"] for step in fixture["sequence"] if step.get("payload")]
    record = run_fixture(name, outcome_map)
    emitted = record.to_dict()["raw"]["last_payload"]

    if not payload_steps:
        assert emitted is None
        return

    observed_count = len([o for o in record.observations if o.payload is not None])
    expected = payload_steps[min(observed_count, len(payload_steps)) - 1]
    assert emitted == expected
    assert json.loads(json.dumps(emitted)) == expected


def test_unknown_upstream_fields_are_preserved(outcome_map: OutcomeMap) -> None:
    record = run_fixture("unknown_failure_code.json", outcome_map)
    last = record.to_dict()["raw"]["last_payload"]
    assert last["vendor_hint"] == "unrecognised-field-preserved"
    assert last["failure_code"] == "carrier_reject_42"


def test_reconciling_the_same_observations_twice_is_idempotent(outcome_map: OutcomeMap) -> None:
    observations = [
        Observation("rest.calls", {"status": "in_progress"}, "2026-08-06T10:00:00+00:00"),
        Observation("rest.calls", {"status": "completed", "duration_seconds": 9}, "2026-08-06T10:00:30+00:00"),
    ]
    first = reconcile("call_x", observations, outcome_map).to_dict()
    second = reconcile("call_x", observations, outcome_map).to_dict()
    assert first == second


def test_mutating_the_record_cannot_mutate_the_source_payload(outcome_map: OutcomeMap) -> None:
    payload = {"status": "completed", "nested": {"keep": "me"}}
    observations = [Observation("rest.calls", payload, "2026-08-06T10:00:00+00:00")]
    record = reconcile("call_x", observations, outcome_map)
    emitted = record.to_dict()
    emitted["raw"]["last_payload"]["nested"]["keep"] = "mutated"
    assert payload["nested"]["keep"] == "me"


def test_an_undocumented_surface_never_produces_a_semantic_outcome(outcome_map: OutcomeMap) -> None:
    observations = [Observation("rest.imaginary", {"status": "completed"}, "2026-08-06T10:00:00+00:00")]
    record = reconcile("call_x", observations, outcome_map)
    assert record.outcome == "unresolved"
    assert record.reason == "undocumented_code"


def test_a_payload_without_a_status_field_is_malformed(outcome_map: OutcomeMap) -> None:
    observations = [Observation("rest.calls", {"id": "call_x"}, "2026-08-06T10:00:00+00:00")]
    record = reconcile("call_x", observations, outcome_map)
    assert record.outcome == "unresolved"
    assert record.reason == "malformed_payload"


def test_no_observations_resolves_explicitly(outcome_map: OutcomeMap) -> None:
    record = reconcile("call_x", [], outcome_map)
    assert record.outcome == "unresolved"
    assert record.reason == "no_observations"


def test_transport_errors_alone_never_produce_a_semantic_outcome(outcome_map: OutcomeMap) -> None:
    observations = [
        Observation("rest.calls", None, "2026-08-06T10:00:00+00:00", transport_error="connection reset"),
        Observation("rest.calls", None, "2026-08-06T10:00:05+00:00", transport_error="HTTP 502"),
    ]
    record = reconcile("call_x", observations, outcome_map, exhausted=True)
    assert record.outcome == "unresolved"
    assert record.reason == "polling_budget_exhausted"
    assert any("transport error" in note for note in record.evidence.notes)


def attempt(started: str | None, completed: str | None, turns: list | None = None) -> dict:
    """One CallTaskAttempt, per calle.openapi.yaml v0.6.0."""
    return {
        "id": "att_1",
        "phone": "+15550101234",
        "status": "completed",
        "started_at": started,
        "completed_at": completed,
        "summary": None,
        "transcript_turns": turns if turns is not None else [],
        "provider_call_id": None,
        "failure_code": None,
        "failure_message": None,
    }


def call_task(status: str, completed_at: str | None, attempts: list) -> dict:
    return {
        "id": "call_x",
        "object": "call_task",
        "status": status,
        "recipients": [{"id": "rcp_1", "phones": ["+15550101234"], "attempts": attempts}],
        "failure_code": None,
        "created_at": "2026-08-06T10:00:00Z",
        "completed_at": completed_at,
    }


@pytest.mark.parametrize(
    "surface,payload,guard_id",
    [
        (
            "rest.calls",
            call_task("completed", None, [attempt("2026-08-06T10:00:00Z", "2026-08-06T10:00:09Z")]),
            "guard.completed_without_completion_time",
        ),
        (
            "rest.calls",
            call_task(
                "completed",
                "2026-08-06T10:00:11Z",
                [attempt("2026-08-06T10:00:09Z", "2026-08-06T10:00:09Z")],
            ),
            "guard.completed_without_media",
        ),
        (
            "mcp.get_call_run",
            {
                "status": "DECLINED",
                "started_at": "2026-08-06T10:00:07Z",
                "ended_at": "2026-08-06T10:00:07Z",
                "transcript": "",
            },
            "guard.declined_without_media",
        ),
        (
            "mcp.get_call_run",
            {"status": "DECLINED", "duration_seconds": 0, "transcript": ""},
            "guard.declined_without_elapsed_time",
        ),
    ],
)
def test_each_guard_fires_before_mapping_on_a_real_payload_shape(
    surface: str, payload: dict, guard_id: str, outcome_map: OutcomeMap
) -> None:
    """Every guard must be reachable by a payload the contract could actually produce.

    Asserting the guard id is the point: a guard keyed on a field that upstream
    never sends is inert, and a test that only checks the reason would pass
    while another guard did the work.
    """
    assert outcome_map.failing_guard(surface, payload) is not None
    assert outcome_map.failing_guard(surface, payload).id == guard_id

    record = reconcile("call_x", [Observation(surface, payload, "2026-08-06T10:00:00+00:00")], outcome_map)
    assert record.outcome == "unresolved"
    assert record.reason == "inconsistent_payload"
    assert record.mapping.matched is False
    assert any(guard_id in step for step in record.evidence.decision)


def test_a_completion_with_real_media_is_not_guarded(outcome_map: OutcomeMap) -> None:
    """The guards must not fire on an ordinary successful call."""
    payload = call_task(
        "completed",
        "2026-08-06T10:00:52Z",
        [
            attempt(
                "2026-08-06T10:00:05Z",
                "2026-08-06T10:00:47Z",
                [{"offset_seconds": 0, "speaker": "bot", "text": "Hello."}],
            )
        ],
    )
    assert outcome_map.failing_guard("rest.calls", payload) is None
    record = reconcile("call_x", [Observation("rest.calls", payload, "2026-08-06T10:00:00+00:00")], outcome_map)
    assert record.outcome == "completed"


def test_a_call_that_established_media_on_any_attempt_is_not_guarded(outcome_map: OutcomeMap) -> None:
    """One failed pre-media attempt does not make a completed call media-free."""
    payload = call_task(
        "completed",
        "2026-08-06T10:01:00Z",
        [
            attempt("2026-08-06T10:00:05Z", "2026-08-06T10:00:05Z"),
            attempt(
                "2026-08-06T10:00:30Z",
                "2026-08-06T10:00:58Z",
                [{"offset_seconds": 0, "speaker": "user", "text": "Hello?"}],
            ),
        ],
    )
    assert outcome_map.failing_guard("rest.calls", payload) is None


@pytest.mark.parametrize(
    "payload,outcome,entry_id",
    [
        ({"status": "failed", "error": {"code": "no_answer"}}, "not_connected", "rest.goal_runs.no_answer"),
        ({"status": "failed", "error": {"code": "declined"}}, "declined", "rest.goal_runs.declined"),
        ({"status": "canceled", "error": {"code": "canceled"}}, "cancelled", "rest.goal_runs.canceled"),
        ({"status": "completed", "error": None}, "completed", "rest.goal_runs.completed"),
        ({"status": "canceled", "error": None}, "cancelled", "rest.goal_runs.status_canceled"),
    ],
)
def test_goal_run_outcomes_are_read_from_the_nested_error_code(
    payload: dict, outcome: str, entry_id: str, outcome_map: OutcomeMap
) -> None:
    record = reconcile(
        "rgrp_x", [Observation("rest.goal_runs", payload, "2026-08-06T10:00:00+00:00")], outcome_map
    )
    assert record.outcome == outcome
    assert record.mapping.entry_id == entry_id


def test_a_goal_run_error_describes_the_run_rather_than_its_lifecycle_state(
    outcome_map: OutcomeMap,
) -> None:
    """A completed run carrying a result error is not reported as a completion."""
    payload = {"status": "completed", "error": {"code": "result_invalid"}}
    record = reconcile(
        "rgrp_x", [Observation("rest.goal_runs", payload, "2026-08-06T10:00:00+00:00")], outcome_map
    )
    assert record.outcome == "unresolved"
    assert record.reason == "result_error_not_call_outcome"


def test_a_failed_goal_run_with_no_error_is_not_guessed_at(outcome_map: OutcomeMap) -> None:
    """Terminal, but nothing documented applies. Say so rather than inventing."""
    payload = {"status": "failed", "error": None}
    record = reconcile(
        "rgrp_x", [Observation("rest.goal_runs", payload, "2026-08-06T10:00:00+00:00")], outcome_map
    )
    assert record.outcome == "unresolved"
    assert record.reason == "undocumented_code"


def test_goal_run_polling_follows_the_lifecycle_enum_not_the_error_codes(
    outcome_map: OutcomeMap,
) -> None:
    assert outcome_map.is_terminal("rest.goal_runs", {"status": "queued"}) is False
    assert outcome_map.is_terminal("rest.goal_runs", {"status": "in_progress"}) is False
    assert outcome_map.is_terminal("rest.goal_runs", {"status": "failed"}) is True
    # An error code is not a lifecycle state and must not end polling.
    assert outcome_map.is_terminal("rest.goal_runs", {"status": "no_answer"}) is False


def test_a_matched_outcome_always_names_the_entry_that_produced_it(outcome_map: OutcomeMap) -> None:
    for name in FIXTURES:
        record = run_fixture(name, outcome_map)
        if record.outcome != "unresolved":
            assert record.mapping.matched is True
            assert record.mapping.entry_id
            assert any(e.id == record.mapping.entry_id for e in outcome_map.entries)


def test_unresolved_records_never_claim_a_mapping(outcome_map: OutcomeMap) -> None:
    for name in FIXTURES:
        record = run_fixture(name, outcome_map)
        if record.outcome == "unresolved":
            assert record.mapping.matched is False
            assert record.mapping.entry_id is None
            assert record.reason


def test_records_carry_a_decision_trail(outcome_map: OutcomeMap) -> None:
    record = run_fixture("stuck.json", outcome_map)
    assert record.evidence.decision, "explain needs a decision trail to print"
    assert record.evidence.observed_states


@pytest.mark.parametrize(
    "raw,masked",
    [
        ("+15550101234", "+1555010****"),
        ("+15550101", "+1555010*"),
        (None, None),
    ],
)
def test_phone_masking(raw: str | None, masked: str | None) -> None:
    assert mask_phone(raw) == masked


def test_record_rejects_an_unresolved_outcome_without_a_reason(outcome_map: OutcomeMap) -> None:
    from record import Evidence, MappingTrace, OutcomeRecord

    with pytest.raises(ValueError, match="must carry a reason"):
        OutcomeRecord(
            call_ref="call_x",
            outcome="unresolved",
            reason=None,
            mapping=MappingTrace(False, None, "test"),
            evidence=Evidence(),
            observations=[],
        )


def test_record_rejects_an_unknown_outcome() -> None:
    from record import Evidence, MappingTrace, OutcomeRecord

    with pytest.raises(ValueError, match="Unknown outcome"):
        OutcomeRecord(
            call_ref="call_x",
            outcome="probably_fine",
            reason=None,
            mapping=MappingTrace(False, None, "test"),
            evidence=Evidence(),
            observations=[],
        )


def test_fixtures_use_reserved_example_numbers_only() -> None:
    """Repository rule: documentation and fixtures use fictional numbers."""
    for path in FIXTURE_DIR.glob("*.json"):
        text = path.read_text(encoding="utf-8")
        assert "+1555010" in text or "phone" not in text, f"{path.name} must use a reserved number"
        assert "+1555010" in text or "recipient_phone" not in text


def test_property_any_payload_yields_one_outcome_and_preserves_raw(outcome_map: OutcomeMap) -> None:
    """The two core guarantees, enforced together over adversarial payloads."""
    payloads = [
        {"status": "completed"},
        {"status": "completed", "duration_seconds": 0},
        {"status": "queued"},
        {"status": "failed", "failure_code": "anything_at_all"},
        {"status": "canceled"},
        {"status": ""},
        {"status": None},
        {"status": 12345},
        {"status": {"nested": "object"}},
        {"status": ["list"]},
        {},
        {"unexpected": "shape", "deeply": {"nested": [1, 2, {"three": True}]}},
        {"code": "no_answer"},
        {"code": "invented_code"},
        {"status": "COMPLETED"},
        {"status": "DECLINED", "duration_seconds": 0},
        {"status": "DECLINED", "started_at": "t", "ended_at": "t", "transcript": ""},
        {"status": "failed", "error": {"code": "no_answer"}},
        {"status": "completed", "error": None},
        {"status": "completed", "error": "not an object"},
        {"status": "completed", "recipients": "not a list"},
        {"status": "completed", "recipients": [{"attempts": "not a list"}]},
        {"status": "completed", "recipients": [{"attempts": [{"started_at": None}]}]},
        {"status": "completed", "recipients": [[], {}, "mixed"]},
    ]
    for surface in ("rest.calls", "rest.goal_runs", "mcp.get_call_run", "rest.unknown"):
        for payload in payloads:
            original = copy.deepcopy(payload)
            observations = [Observation(surface, payload, "2026-08-06T10:00:00+00:00")]
            record = reconcile("call_x", observations, outcome_map)

            assert record.outcome in OUTCOMES
            if record.outcome == "unresolved":
                assert record.reason
            emitted = record.to_dict()["raw"]["last_payload"]
            assert emitted == original, f"raw mutated for {surface} {original}"
            assert payload == original, "reconcile mutated its input"


# -- upstream's own post-call judgment ---------------------------------------
#
# Captured from a real call on 2026-08-20 that reached voicemail. Upstream
# reported status: completed with task_completed: false. Reporting the outcome
# alone is true and still misleading, so the record carries the judgment too.


def test_upstream_judgment_is_surfaced_when_published(outcome_map: OutcomeMap) -> None:
    payload = {
        "status": "completed",
        "completed_at": "2026-08-20T05:46:47Z",
        "task_completed": False,
        "completion_confidence": {"score": 0.82, "label": "high"},
        "summary": "The call reached voicemail.",
        "evidence": ["The call reached voicemail instead of a live person."],
    }
    record = reconcile("call_x", [Observation("rest.calls", payload, "2026-08-20T05:46:47+00:00")], outcome_map)
    assert record.outcome == "completed"  # faithful to CallStatus; not our call to override

    judgment = record.to_dict()["upstream_judgment"]
    assert judgment["task_completed"] is False
    assert judgment["completion_confidence"]["label"] == "high"
    assert "voicemail" in judgment["summary"]


def test_upstream_judgment_is_absent_when_upstream_published_none(outcome_map: OutcomeMap) -> None:
    payload = {"status": "completed", "completed_at": "2026-08-20T05:46:47Z"}
    record = reconcile("call_x", [Observation("rest.calls", payload, "2026-08-20T05:46:47+00:00")], outcome_map)
    assert record.to_dict()["upstream_judgment"] is None


def test_the_recipient_is_read_from_the_payload_when_it_names_one(outcome_map: OutcomeMap) -> None:
    """A record saying "unknown recipient" while carrying the number in raw is hiding what it has."""
    payload = call_task("completed", "2026-08-20T05:46:47Z", [attempt("a", "b", [{"text": "hi"}])])
    record = reconcile("call_x", [Observation("rest.calls", payload, "2026-08-20T05:46:47+00:00")], outcome_map)
    assert record.to_dict()["recipient"]["phone_e164_masked"] == "+1555010****"


def test_an_explicit_recipient_wins_over_the_payload(outcome_map: OutcomeMap) -> None:
    payload = call_task("completed", "2026-08-20T05:46:47Z", [attempt("a", "b", [{"text": "hi"}])])
    record = reconcile(
        "call_x",
        [Observation("rest.calls", payload, "2026-08-20T05:46:47+00:00")],
        outcome_map,
        recipient_phone="+15550109999",
    )
    assert record.to_dict()["recipient"]["phone_e164_masked"] == "+1555010****"
    assert record.recipient_phone == "+15550109999"


def test_a_batch_call_reports_no_single_recipient(outcome_map: OutcomeMap) -> None:
    """Masking one number out of several would label the record with the wrong person."""
    payload = {
        "status": "completed",
        "completed_at": "2026-08-20T05:46:47Z",
        "recipients": [
            {"id": "r1", "phones": ["+15550101234"], "attempts": []},
            {"id": "r2", "phones": ["+15550105678"], "attempts": []},
        ],
    }
    record = reconcile("call_x", [Observation("rest.calls", payload, "2026-08-20T05:46:47+00:00")], outcome_map)
    assert record.to_dict()["recipient"]["phone_e164_masked"] is None


def test_no_fixture_carries_a_live_api_timestamp() -> None:
    """Fixtures must be written, not captured.

    A CALL-E response stamps microseconds (`2026-01-02T09:00:00.531981Z`); a
    hand-written fixture uses whole seconds. Sub-second precision is therefore a
    reliable fingerprint of a payload copied from a real call — and a real
    call's payload carries its transcript, which is a recording in text form.

    This exists because exactly that happened once: a live voicemail payload was
    scrubbed of identifiers and committed with its transcript intact.
    """
    captured = []
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        for stamp in re.findall(r'"\d{4}-\d{2}-\d{2}T[\d:]+(\.\d+)Z?"', path.read_text(encoding="utf-8")):
            captured.append(path.name)
            break
    assert not captured, (
        f"fixtures appear to be captured from live calls, not written: {captured}. "
        "Build fixtures from the documented schema instead."
    )


def test_the_guard_above_can_actually_detect_a_captured_payload(tmp_path: Path) -> None:
    """Positive control: prove the fingerprint test is not vacuous."""
    sample = '{"created_at": "2026-01-02T09:00:00.531981Z"}'
    assert re.findall(r'"\d{4}-\d{2}-\d{2}T[\d:]+(\.\d+)Z?"', sample), (
        "the live-timestamp fingerprint no longer matches; the guard above is dead"
    )
