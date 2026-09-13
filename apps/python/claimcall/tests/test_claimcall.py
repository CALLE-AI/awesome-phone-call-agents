import copy
import json
import os
import re

import pytest

from claimcall import engine, policy
from claimcall.analysis import analyze_case, missing_information
from claimcall.calle_client import CalleClient, FakeCalleServer
from claimcall.call_plan import PLAN_OBJECTIVES, RESULT_SCHEMA, build_plan, build_request, build_task
from claimcall.models import mask_phone, new_case

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(APP, "fixtures")
EXAMPLES = os.path.join(APP, "examples")


def make_case(**over):
    base = dict(passenger_name="Santee Cooper", airline="EuroSky Airways", booking_ref="ABC123",
                flight_no="ES421", origin="Paris", destination="Bengaluru", flight_status="Cancelled",
                scheduled_date="2026-09-14", airline_hotline="+12125550100", region="US")
    base.update(over)
    return new_case(**base)


@pytest.fixture(scope="module")
def fake():
    server = FakeCalleServer(FIXTURES).start()
    yield server
    server.stop()


@pytest.fixture
def client(fake):
    return CalleClient("fixture-key", fake.base_url, allow_local_fake=True)


# ---- demo case ----------------------------------------------------------------------------

def test_demo_case_loads():
    with open(os.path.join(EXAMPLES, "demo-case.json"), encoding="utf-8") as f:
        seed = json.load(f)
    assert seed["passenger_name"] == "Santee Cooper"
    assert seed["flight_status"] == "Cancelled"
    case = make_case()
    assert case["status"] == "open"
    assert case["cancellation_reason"] is None


# ---- analysis -----------------------------------------------------------------------------

def test_missing_information_analysis():
    missing = missing_information(make_case())
    assert missing == [
        "Official cancellation reason",
        "Replacement itinerary",
        "Hotel accommodation eligibility",
        "Meal assistance",
        "Written disruption confirmation",
    ]


def test_phone_call_recommendation():
    analysis = analyze_case(make_case())
    assert analysis["resolution_required"] is True
    assert analysis["phone_call_recommended"] is True
    assert "unavailable" in analysis["reason"]
    assert len(analysis["missing_information"]) == 5


def test_no_call_recommended_once_resolved(client):
    case = make_case()
    res = engine.run(case, "fixture", client=client, approved=True)
    assert res["placed"] is True
    assert analyze_case(case)["phone_call_recommended"] is False


# ---- plan ---------------------------------------------------------------------------------

def test_call_plan_generation():
    case = make_case()
    plan = build_plan(case, missing_information(case))
    assert plan["purpose"] == "Resolve missing facts for a cancelled flight"
    assert plan["objectives"] == PLAN_OBJECTIVES
    assert len(plan["objectives"]) == 5
    assert len(plan["constraints"]) == 6
    assert plan["requires_human_approval"] is True


def test_policy_boundaries_in_task():
    task = build_task(make_case(), build_plan(make_case(), []))
    for needle in ("Santee Cooper", "EuroSky Airways", "ES421", "ABC123", "Paris", "Bengaluru"):
        assert needle in task
    for boundary in policy.HARD_BOUNDARIES:
        assert boundary in task
    other = build_task(make_case(passenger_name="Sam Traveller", flight_no="ES999"), build_plan(make_case(), []))
    assert "Sam Traveller" in other and "ES999" in other


def test_request_shape_matches_calls_api():
    req = build_request(make_case(), "task text", "key-1")
    assert set(req) == {"task", "recipients", "result_schema", "metadata"}
    assert req["recipients"][0]["phones"] == ["+12125550100"]
    assert req["result_schema"] is RESULT_SCHEMA
    assert req["result_schema"]["additionalProperties"] is False


# ---- safety gates -------------------------------------------------------------------------

def test_cannot_run_without_approval(client):
    res = engine.run(make_case(), "fixture", client=client, approved=False)
    assert res["placed"] is False
    assert "approval" in res["reason"]


def test_cannot_run_live_without_approval(client):
    res = engine.run(make_case(), "live", client=client, approved=False,
                     allowlist="", api_key_present=True)
    assert res["placed"] is False


def test_cannot_run_live_without_credential(client):
    res = engine.run(make_case(), "live", client=client, approved=True,
                     allowlist="", api_key_present=False)
    assert res["placed"] is False
    assert "CALLE_API_KEY" in res["reason"]


def test_live_refuses_bad_destination_and_allowlist(client):
    bad = make_case(airline_hotline="not-a-number")
    res = engine.run(bad, "live", client=client, approved=True, allowlist="", api_key_present=True)
    assert res["placed"] is False
    res = engine.run(make_case(), "live", client=client, approved=True,
                     allowlist="+19995550100", api_key_present=True)
    assert res["placed"] is False
    assert "ALLOWLIST" in res["reason"]


def test_preview_places_no_call_and_needs_nothing():
    res = engine.preview(make_case())
    assert res["placed"] is False
    assert res["masked_destination"] == mask_phone("+12125550100")
    assert "+12125550100" not in json.dumps(res)
    assert "objectives" in res["plan"]


# ---- fixture + state transition -----------------------------------------------------------

def test_fixture_mode_runs_full_workflow(client):
    case = make_case()
    res = engine.run(case, "fixture", client=client, approved=True)
    assert res["placed"] is True
    assert res["call_id"].startswith("call_fake_")
    assert res["call_status"] == "completed"


def test_fixture_result_updates_case(client):
    case = make_case()
    engine.run(case, "fixture", client=client, approved=True)
    assert case["cancellation_reason"] == "Operational aircraft issue"
    assert case["replacement_itinerary"]["available"] is True
    assert "ES455" in case["replacement_itinerary"]["details"]
    assert case["hotel"]["authorised"] is True
    assert case["written_confirmation"]["promised"] is True
    assert case["status"] == "resolved"


def test_malformed_result_fails_closed(client):
    case = make_case()
    before = copy.deepcopy(case)
    call_record = {"id": "call_bad", "structured_result": {"cancellation_reason": "x", "extra": 1}}
    engine.apply_result(case, call_record)
    assert call_record["result_problems"]
    assert case["status"] == "needs_human"
    assert case["cancellation_reason"] == before["cancellation_reason"]
    assert case["replacement_itinerary"] == before["replacement_itinerary"]
    assert case["pending_question"]


def test_unknown_fields_fail_closed():
    assert engine.validate_result(None) == ["no structured result"]
    assert engine.validate_result({"cancellation_reason": None})  # missing required fields + wrong type


def test_bad_enum_value_fails_closed():
    case = make_case()
    result = {
        "cancellation_reason": "Operational aircraft issue",
        "replacement_itinerary": {"available": "maybe", "details": ""},
        "hotel": {"authorised": "yes", "details": ""},
        "meals": {"available": "yes", "details": ""},
        "written_confirmation": {"promised": "yes", "details": ""},
        "representative_commitments": [],
        "unresolved_items": [],
        "recommended_follow_up": "",
    }
    call_record = {"id": "call_bad_enum", "structured_result": result}
    engine.apply_result(case, call_record)
    assert any("replacement_itinerary.available" in p for p in call_record["result_problems"])
    assert case["status"] == "needs_human"
    assert case["cancellation_reason"] is None


def test_before_after_state_generation(client):
    case = make_case()
    engine.run(case, "fixture", client=client, approved=True)
    rows = {r["field"]: r for r in case["before_after"]}
    assert rows["Cancellation reason"]["before"] == "Unknown"
    assert rows["Cancellation reason"]["after"] == "Operational aircraft issue"
    assert rows["Hotel"]["before"] == "Unknown"
    assert "Approved" in rows["Hotel"]["after"] or "accommodation" in rows["Hotel"]["after"]
    assert len(case["before_after"]) == 5


def test_commitments_extraction(client):
    case = make_case()
    engine.run(case, "fixture", client=client, approved=True)
    assert len(case["representative_commitments"]) == 3
    assert any("rebooked" in c for c in case["representative_commitments"])


def test_recommended_next_action(client):
    case = make_case()
    engine.run(case, "fixture", client=client, approved=True)
    action = case["recommended_next_action"]
    assert "written confirmation" in action
    assert "receipts" in action
    for legal in ("entitled to", "compensation of", "EU261", "regulation"):
        assert legal not in action


def test_next_action_when_items_unresolved():
    case = make_case()
    case["unresolved_items"] = ["Meal assistance"]
    assert "Meal assistance" in engine.recommended_next_action(case)


# ---- fixtures carry no secrets or real numbers --------------------------------------------

def test_no_secrets_or_real_numbers_in_fixtures():
    for root, _, files in os.walk(os.path.join(APP, "fixtures")):
        for name in files:
            text = open(os.path.join(root, name), encoding="utf-8").read()
            assert "CALLE_API_KEY" not in text and "Bearer " not in text
    with open(os.path.join(EXAMPLES, "demo-case.json"), encoding="utf-8") as f:
        demo = f.read()
    for number in re.findall(r"\+\d[\d\s().-]{6,}", demo):
        digits = re.sub(r"\D", "", number)
        assert "55501" in digits, f"non-fictional number in demo fixture: {number}"


# ---- UI-typed live destination ------------------------------------------------------------

OVERRIDE_NUMBER = "+14155550100"


def test_region_derived_from_typed_number():
    assert policy.region_for_number("+14155550100") == "US"
    assert policy.region_for_number("+442079460000") == "GB"
    assert policy.region_for_number("+9991234567") is None
    assert policy.region_for_number("not-a-number") is None


def test_live_override_destination_is_dialed(client):
    case = make_case()
    res = engine.run(case, "live", client=client, approved=True, allowlist=OVERRIDE_NUMBER,
                     api_key_present=True, live_destination=OVERRIDE_NUMBER)
    assert res["placed"] is True
    assert res["call"]["hotline_masked"] == mask_phone(OVERRIDE_NUMBER)
    assert case["airline_hotline"] == "+12125550100"  # case facts untouched


def test_live_override_off_allowlist_refused(client):
    res = engine.run(make_case(), "live", client=client, approved=True,
                     allowlist="+19995550100", api_key_present=True,
                     live_destination=OVERRIDE_NUMBER)
    assert res["placed"] is False
    assert "ALLOWLIST" in res["reason"]


def test_live_override_bad_number_refused(client):
    for bad in ("not-a-number", "+9991234567"):
        res = engine.run(make_case(), "live", client=client, approved=True,
                         allowlist="", api_key_present=True, live_destination=bad)
        assert res["placed"] is False, bad
