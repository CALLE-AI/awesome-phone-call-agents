"""P0 regressions: deterministic fake inputs and safe public output."""
import copy
import json

import pytest

from api.progress import StoreObserver
from api.serialize import call_projection
from api.server import queued_entry
from api.store import ResolutionStore
from client import build_recipient
from evidence.model import load_case
from verdict import Verdict, reconcile
from tests.test_api import HERE, api_server_and_backend, create_resolution, await_resolution, post


@pytest.mark.parametrize("phone", ["+12025550187", "+33123456789"])
def test_complete_ascii_phone_is_accepted(phone):
    assert build_recipient(phone, None, None)["phones"] == [phone]


@pytest.mark.parametrize("phone", [
    "+12025550187\n", "+12025550187 ", " +12025550187",
    "+1202 5550187", "+\u0661\u0662\u0660\u0662\u0665\u0665\u0665\u0660\u0661\u0668\u0667", "+\uff11\uff12\uff10\uff12\uff15\uff15\uff15\uff10\uff11\uff18\uff17",
    "x+12025550187", "+12025550187x", "+12025550187\r\n",
])
def test_incomplete_or_non_ascii_phone_is_rejected(phone):
    with pytest.raises(ValueError):
        build_recipient(phone, None, None)


@pytest.mark.parametrize("case_name", ["critical-service-escalation", "ghost-appointment"])
@pytest.mark.parametrize("scenario, verdict", [
    ("no-call", "NO_CALL_NEEDED"), ("confirmed", "RESOLVED"),
    ("cancelled", "RESOLVED_ALT"), ("voicemail", "UNRESOLVED_AMBIGUOUS"),
    ("blocked", "UNRESOLVED_CALL_BLOCKED"),
])
def test_fake_scenarios_need_no_magic_date(case_name, scenario, verdict):
    with api_server_and_backend() as (url, backend):
        status, seed = create_resolution(url, case=case_name, scenario=scenario)
        assert status == 202
        assert seed["mode"] == "fake"
        result = await_resolution(url, seed["id"])
        assert result["state"] == "completed"
        assert result["mode"] == "fake"
        assert result["verdict"]["status"] == verdict
        assert backend.creates == (0 if scenario in ("no-call", "blocked") else 1)
        r4 = result["reasoning"]["rules"][3]
        assert r4["triggered"] is (scenario != "no-call")


def test_no_call_prepares_conditions_even_with_explicit_near_time():
    with api_server_and_backend() as (url, backend):
        status, seed = create_resolution(url, case="critical-service-escalation",
            scenario="no-call", now_utc="2099-01-01T00:00:00Z")
        assert status == 202
        result = await_resolution(url, seed["id"])
        assert result["verdict"]["status"] == "NO_CALL_NEEDED"
        assert result["compliance"] is None
        assert backend.creates == 0
        status, body, _ = post(
            url,
            "/api/resolutions",
            {"case": "critical-service-escalation", "execution_mode": "live", "scenario": "no-call"},
            headers={"X-Calle-Api-Key": "not-a-real-key"},
        )
        assert status == 422
        assert body["error"]["code"] == "field_not_allowed"
        assert backend.creates == 0


@pytest.mark.parametrize("mode", ["fake", "live"])
def test_observer_preserves_seed_mode_at_every_state(mode):
    case = load_case(HERE / "cases" / "critical-service-escalation.json")
    store = ResolutionStore()
    store.put("test", queued_entry("test", case, mode))
    observer = StoreObserver(store, "test")
    assert (store.get("test")["state"], store.get("test")["mode"]) == ("queued", mode)
    observer.on_start(case, "EXECUTE")
    assert (store.get("test")["state"], store.get("test")["mode"]) == ("running", mode)
    observer.on_verdict(Verdict("NO_CALL_NEEDED", "NO_ACTION_REQUIRED", ()))
    assert (store.get("test")["state"], store.get("test")["mode"]) == ("completed", mode)


@pytest.mark.parametrize("secret", [
    "iams_live_not_a_real_credential", "sk-test_not_a_real_key",
    "Bearer abc123.fake-token", "api_key=obvious-private-value",
    'token="private value"', "eyJabc.def.ghi",
])
def test_provider_notes_hide_phones_and_obvious_secrets_without_mutation(secret):
    raw = {"status": "completed", "structured_result": {
        "subject_intent": "confirmed", "answered_by": "human",
        "manipulation_attempt_detected": False,
        "confidence_note": "Call +12025550187 with " + secret,
        "manipulation_attempt_note": secret,
    }}
    original = copy.deepcopy(raw)
    public = call_projection(raw, True)
    rendered = json.dumps(public)
    assert "+12025550187" not in rendered
    assert secret not in rendered
    assert "[redacted]" in rendered
    assert public["result"]["subject_intent"] == "confirmed"
    assert raw == original
    case = load_case(HERE / "cases" / "critical-service-escalation.json")
    assert reconcile(raw["structured_result"], case.decision_options, case.evidence).status == "RESOLVED"


@pytest.mark.parametrize("value", [{"token": "private"}, ["private"], 1, None])
def test_unexpected_provider_shapes_are_not_projected(value):
    assert call_projection({"status": value, "structured_result": value}, True) == {
        "placed": True, "provider_status": None, "result": None}
    fields = {key: value for key in ("subject_intent", "answered_by",
        "confidence_note", "manipulation_attempt_note", "manipulation_attempt_detected")}
    assert call_projection({"structured_result": fields}, True)["result"] is None


def test_invalid_enum_strings_are_not_reflected_and_notes_are_bounded():
    public = call_projection({"status": "secret status", "structured_result": {
        "subject_intent": "secret intent", "answered_by": "secret answer",
        "confidence_note": "iams_" + "x" * 3000,
        "manipulation_attempt_note": "a" * 3000,
    }}, True)
    assert public["provider_status"] is None
    assert "subject_intent" not in public["result"]
    assert "answered_by" not in public["result"]
    assert public["result"]["confidence_note"] == "[redacted]"
    assert len(public["result"]["manipulation_attempt_note"]) == 2000


def test_fake_decision_clock_is_fixture_relative(monkeypatch):
    import pipeline
    from datetime import timedelta

    evaluated_times = []
    original = pipeline.evaluate

    def record(matrix, deadline, now, threshold):
        evaluated_times.append((deadline, now, threshold))
        return original(matrix, deadline, now, threshold)

    monkeypatch.setattr(pipeline, "evaluate", record)
    with api_server_and_backend() as (url, backend):
        for scenario in ("confirmed", "no-call"):
            status, seed = create_resolution(url, case="critical-service-escalation", scenario=scenario)
            assert status == 202
            result = await_resolution(url, seed["id"])
            assert result["state"] == "completed"
        assert backend.creates == 1
    deadline, now, threshold = evaluated_times[0]
    assert now == deadline - threshold / 2
    deadline, now, threshold = evaluated_times[1]
    assert now == deadline - threshold - timedelta(seconds=1)
