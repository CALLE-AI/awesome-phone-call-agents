from pathlib import Path

import pytest

from fieldline.demo_data import demo_trip_plan
from fieldline.schemas import (
    CHECKIN_RESULT_SCHEMA,
    ESCALATION_RESULT_SCHEMA,
    TripPlanError,
    add_minutes,
    load_trip_plan,
    mask_phone,
)

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "trip.yaml"


def test_example_plan_loads_and_matches_demo_plan():
    plan = load_trip_plan(EXAMPLE)
    demo = demo_trip_plan()
    assert plan.label == demo.label
    assert plan.checkins == demo.checkins
    assert plan.duress_phrase == demo.duress_phrase
    assert [c.name for c in plan.escalation] == [c.name for c in demo.escalation]
    assert plan.worker.phone == demo.worker.phone


def test_result_schemas_are_wellformed():
    for schema in (CHECKIN_RESULT_SCHEMA, ESCALATION_RESULT_SCHEMA):
        assert schema["type"] == "object"
        assert set(schema["required"]) <= set(schema["properties"])


def test_short_duress_phrase_rejected(tmp_path):
    bad = EXAMPLE.read_text().replace("the weather has been lovely all week", "ok")
    p = tmp_path / "bad.yaml"
    p.write_text(bad)
    with pytest.raises(TripPlanError, match="Duress phrase"):
        load_trip_plan(p)


def test_non_e164_phone_rejected(tmp_path):
    bad = EXAMPLE.read_text().replace("+15555550100", "0555-01-00")
    p = tmp_path / "bad.yaml"
    p.write_text(bad)
    with pytest.raises(TripPlanError, match="E.164"):
        load_trip_plan(p)


def test_mask_phone():
    assert mask_phone("+15555550100") == "+1•••0100"
    assert "5555501" not in mask_phone("+15555550100")
    assert "*" not in mask_phone("+15555550100")  # '*' breaks markdown rendering


def test_add_minutes():
    assert add_minutes("18:00", 5) == "18:05"
    assert add_minutes("18:58", 5) == "19:03"
    assert add_minutes("23:58", 5) == "00:03"
