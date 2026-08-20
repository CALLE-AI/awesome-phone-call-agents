"""Tests for the mapping table loader.

These run with no credentials and no network.
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest
import yaml

from mapping import MappingError, OutcomeMap, default_map_path
from record import MAPPABLE_OUTCOMES, UNRESOLVED_REASONS

APP_DIR = Path(__file__).resolve().parent
SKILL_MAP = APP_DIR.parents[2] / "skills" / "call-outcome-reconciler" / "outcome-code-map.yaml"


@pytest.fixture(scope="module")
def outcome_map() -> OutcomeMap:
    return OutcomeMap.load()


@pytest.fixture(scope="module")
def raw_table() -> dict:
    return yaml.safe_load(default_map_path().read_text(encoding="utf-8"))


def test_app_copy_matches_the_skill_source_of_truth() -> None:
    """The skill owns the mapping; the app ships a synchronised copy.

    Regenerate with:
        node skills/call-outcome-reconciler/scripts/sync-mapping.mjs
    """
    if not SKILL_MAP.exists():
        pytest.skip("skill copy not present; app is running outside the repository checkout")
    assert default_map_path().read_bytes() == SKILL_MAP.read_bytes(), (
        "outcome-code-map.yaml has drifted from the skill copy. "
        "Run: node skills/call-outcome-reconciler/scripts/sync-mapping.mjs"
    )


def test_table_loads_and_declares_a_version(outcome_map: OutcomeMap) -> None:
    assert outcome_map.map_version
    assert outcome_map.upstream_contract_ref
    assert outcome_map.surfaces


def test_every_entry_is_documented_cites_a_source_and_maps_a_real_outcome(
    outcome_map: OutcomeMap,
) -> None:
    assert outcome_map.entries, "the table must document at least one case"
    for entry in outcome_map.entries:
        assert entry.outcome in MAPPABLE_OUTCOMES
        assert entry.source, f"{entry.id} must cite a source"
        assert entry.surface in outcome_map.surfaces


def test_unmappable_items_declare_known_reasons(outcome_map: OutcomeMap) -> None:
    for item in outcome_map.unmappable:
        assert item.reason in UNRESOLVED_REASONS
        assert item.note, f"{item.id} must explain why no documented outcome exists"


def test_guards_declare_known_reasons(outcome_map: OutcomeMap) -> None:
    for guard in outcome_map.guards:
        assert guard.reason in UNRESOLVED_REASONS
        assert guard.when


def test_semantic_outcomes_are_reachable_only_from_documented_surfaces(
    outcome_map: OutcomeMap,
) -> None:
    """An undocumented surface must never carry a documented entry."""
    for entry in outcome_map.entries:
        assert outcome_map.surfaces[entry.surface].documented, (
            f"{entry.id} maps a value on undocumented surface {entry.surface}"
        )


def test_loader_refuses_an_entry_marked_undocumented(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"][0]["documented"] = False
    with pytest.raises(MappingError, match="documented: true"):
        OutcomeMap(broken)


def test_loader_refuses_an_entry_with_no_documented_flag(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    del broken["entries"][0]["documented"]
    with pytest.raises(MappingError, match="documented: true"):
        OutcomeMap(broken)


def test_loader_refuses_an_unknown_outcome(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"][0]["outcome"] = "probably_fine"
    with pytest.raises(MappingError, match="unmappable outcome"):
        OutcomeMap(broken)


def test_loader_refuses_to_map_unresolved(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"][0]["outcome"] = "unresolved"
    with pytest.raises(MappingError, match="unmappable outcome"):
        OutcomeMap(broken)


def test_loader_refuses_an_entry_without_a_source(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    del broken["entries"][0]["source"]
    with pytest.raises(MappingError, match="must cite a source"):
        OutcomeMap(broken)


def test_loader_refuses_an_unknown_surface(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"][0]["surface"] = "rest.imaginary"
    with pytest.raises(MappingError, match="unknown surface"):
        OutcomeMap(broken)


def test_loader_refuses_duplicate_ids(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"].append(copy.deepcopy(broken["entries"][0]))
    with pytest.raises(MappingError, match="Duplicate id"):
        OutcomeMap(broken)


def test_loader_refuses_an_empty_match_block(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["entries"][0]["match"] = {}
    with pytest.raises(MappingError, match="non-empty match block"):
        OutcomeMap(broken)


def test_loader_refuses_an_unsupported_guard_predicate(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["consistency_guards"][0]["when"] = [{"field": "status", "looks_like": "DECLINED"}]
    with pytest.raises(MappingError, match="exactly one of"):
        OutcomeMap(broken)


# -- field paths ------------------------------------------------------------


@pytest.mark.parametrize(
    "path,payload,expected",
    [
        ("status", {"status": "completed"}, ["completed"]),
        ("status", {}, []),
        ("error.code", {"error": {"code": "no_answer"}}, ["no_answer"]),
        ("error.code", {"error": None}, []),
        ("error.code", {}, []),
        ("a[].b", {"a": [{"b": 1}, {"b": 2}]}, [1, 2]),
        ("a[].b", {"a": []}, []),
        ("a[].b", {"a": "not a list"}, []),
        ("a.b", {"a": "not a mapping"}, []),
        ("x[].y[].z", {"x": [{"y": [{"z": 1}, {"z": 2}]}, {"y": [{"z": 3}]}]}, [1, 2, 3]),
    ],
)
def test_path_resolution_is_total(path: str, payload: dict, expected: list) -> None:
    """An unexpected payload shape yields no values rather than raising."""
    from mapping import _resolve_path

    assert _resolve_path(payload, path) == expected


def test_a_fan_out_path_must_hold_for_every_resolved_value(outcome_map: OutcomeMap) -> None:
    from mapping import _predicate_holds

    clause = {"field": "a[].b", "equals": 1}
    assert _predicate_holds(clause, {"a": [{"b": 1}, {"b": 1}]}) is True
    assert _predicate_holds(clause, {"a": [{"b": 1}, {"b": 2}]}) is False
    assert _predicate_holds(clause, {"a": []}) is False


def test_equals_field_compares_within_one_node_not_across_siblings() -> None:
    """Attempt A's started_at must never be compared to attempt B's completed_at."""
    from mapping import _predicate_holds

    clause = {"field": "a[].start", "equals_field": "a[].end"}
    assert _predicate_holds(clause, {"a": [{"start": "t1", "end": "t1"}]}) is True
    assert _predicate_holds(clause, {"a": [{"start": "t1", "end": "t2"}]}) is False
    # Were the two paths resolved independently and zipped, this would compare
    # t1 with t2 and t2 with t1 and wrongly report a match on neither.
    assert (
        _predicate_holds(
            clause, {"a": [{"start": "t1", "end": "t2"}, {"start": "t2", "end": "t1"}]}
        )
        is False
    )


def test_equals_field_is_not_satisfied_by_two_absent_or_null_values() -> None:
    """A queued attempt has neither timestamp; that is not evidence of anything."""
    from mapping import _predicate_holds

    clause = {"field": "started_at", "equals_field": "ended_at"}
    assert _predicate_holds(clause, {"started_at": None, "ended_at": None}) is False
    assert _predicate_holds(clause, {}) is False
    assert _predicate_holds(clause, {"started_at": "t", "ended_at": "t"}) is True


def test_loader_refuses_equals_field_operands_from_different_scopes(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["consistency_guards"][0]["when"] = [
        {"field": "recipients[].attempts[].started_at", "equals_field": "recipients[].completed_at"}
    ]
    with pytest.raises(MappingError, match="must share a scope"):
        OutcomeMap(broken)


def test_loader_refuses_a_malformed_field_path(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["consistency_guards"][0]["when"] = [{"field": "recipients[].", "equals": "x"}]
    with pytest.raises(MappingError, match="malformed field path"):
        OutcomeMap(broken)


def test_loader_requires_a_source_for_a_guard_on_an_undocumented_surface(raw_table: dict) -> None:
    """An undocumented surface has no contract, so the fields a guard reads must be cited."""
    broken = copy.deepcopy(raw_table)
    undocumented = [
        guard
        for guard in broken["consistency_guards"]
        if not broken["surfaces"][guard["surface"]].get("documented")
    ]
    assert undocumented, "the table must exercise this rule"
    del undocumented[0]["source"]
    with pytest.raises(MappingError, match="must cite a source"):
        OutcomeMap(broken)


def test_loader_refuses_an_unknown_schema_version(raw_table: dict) -> None:
    broken = copy.deepcopy(raw_table)
    broken["schema_version"] = 99
    with pytest.raises(MappingError, match="Unsupported mapping schema_version"):
        OutcomeMap(broken)


def test_unknown_match_keys_never_fall_through_to_a_default(outcome_map: OutcomeMap) -> None:
    assert outcome_map.lookup("rest.calls", {"status": "invented_status"}) is None
    assert outcome_map.lookup("rest.calls", {"unrelated": "field"}) is None


def test_matching_never_crosses_surfaces(outcome_map: OutcomeMap) -> None:
    """A documented REST value must not match through an undocumented surface."""
    assert outcome_map.lookup("rest.calls", {"status": "completed"}) is not None
    assert outcome_map.lookup("mcp.get_call_run", {"status": "completed"}) is None
    assert outcome_map.lookup("mcp.get_call_run", {"status": "COMPLETED"}) is None
    assert outcome_map.lookup("rest.calls", {"status": "COMPLETED"}) is None


def test_terminality_is_operational_not_semantic(outcome_map: OutcomeMap) -> None:
    """A value can end polling and still have no documented meaning."""
    payload = {"status": "COMPLETED"}
    assert outcome_map.is_terminal("mcp.get_call_run", payload) is True
    assert outcome_map.lookup("mcp.get_call_run", payload) is None


def test_non_terminal_states_do_not_end_polling(outcome_map: OutcomeMap) -> None:
    assert outcome_map.is_terminal("rest.calls", {"status": "queued"}) is False
    assert outcome_map.is_terminal("rest.calls", {"status": "in_progress"}) is False
    assert outcome_map.is_terminal("rest.calls", {"status": "completed"}) is True


def test_unknown_surface_is_never_terminal(outcome_map: OutcomeMap) -> None:
    assert outcome_map.knows_surface("rest.imaginary") is False
    assert outcome_map.is_terminal("rest.imaginary", {"status": "completed"}) is False


def test_every_table_id_is_documented_in_the_reference(outcome_map: OutcomeMap) -> None:
    """The reference explains the table; a new id must not land undocumented."""
    reference = SKILL_MAP.parent / "references" / "outcome-code-map.md"
    if not reference.exists():
        pytest.skip("skill reference not present; app is running outside the repository checkout")
    text = reference.read_text(encoding="utf-8")
    documented_ids = (
        [entry.id for entry in outcome_map.entries]
        + [item.id for item in outcome_map.unmappable]
        + [guard.id for guard in outcome_map.guards]
    )
    missing = [item_id for item_id in documented_ids if item_id not in text]
    assert not missing, f"undocumented in references/outcome-code-map.md: {missing}"


def test_every_surface_is_documented_in_the_reference(outcome_map: OutcomeMap) -> None:
    reference = SKILL_MAP.parent / "references" / "outcome-code-map.md"
    if not reference.exists():
        pytest.skip("skill reference not present; app is running outside the repository checkout")
    text = reference.read_text(encoding="utf-8")
    missing = [name for name in outcome_map.surfaces if name not in text]
    assert not missing, f"undocumented surfaces: {missing}"
