"""Tests for the reconciliation state machine.

These run with no credentials and no network: every observation comes from a
recorded fixture or is constructed inline.
"""

from __future__ import annotations

import copy
import json
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


def test_guards_fire_before_mapping(outcome_map: OutcomeMap) -> None:
    """A zero-duration completion is contradictory and is not reported as completed."""
    observations = [
        Observation("rest.calls", {"status": "completed", "duration_seconds": 0}, "2026-08-06T10:00:00+00:00")
    ]
    record = reconcile("call_x", observations, outcome_map)
    assert record.outcome == "unresolved"
    assert record.reason == "inconsistent_payload"
    assert record.mapping.matched is False


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
