import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

from casechaser import engine, policy
from casechaser.client import CalleClient, FakeCalleServer
from casechaser.models import Ledger, new_case
from casechaser.plan import RESULT_SCHEMA, build_request, build_task

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(APP, "fixtures")
BUSINESS_TUESDAY = datetime(2026, 9, 1, 15, 0, tzinfo=timezone.utc)   # 11:00 New York, Tuesday


def make_case(**over):
    base = dict(customer_name="Alex Example", company="Example Home Insurance", hotline="+12125550100", region="US",
                case_type="insurance_claim", reference="EXAMPLE-CLAIM-0001", summary="Burst pipe claim.", what_is_owed="4,200 dollars",
                opened_on="2026-08-13", timezone_name="America/New_York", ivr_hints="press 2 then 3")
    base.update(over)
    return new_case(**base)


@pytest.fixture
def ledger():
    with tempfile.TemporaryDirectory() as d:
        yield Ledger(d)


@pytest.fixture(scope="module")
def fake():
    server = FakeCalleServer(FIXTURES).start()
    yield server
    server.stop()


# ---- policy -------------------------------------------------------------------------------

def test_callable_in_business_hours():
    assert policy.suppression_reasons(make_case(), BUSINESS_TUESDAY) == []


def test_quiet_hours_and_weekend_are_named_reasons():
    night = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)   # 23:00 New York Monday
    assert "quiet_hours" in [r for r, _ in policy.suppression_reasons(make_case(), night)]
    saturday = datetime(2026, 9, 5, 15, 0, tzinfo=timezone.utc)
    assert "quiet_hours" in [r for r, _ in policy.suppression_reasons(make_case(), saturday)]


def test_short_and_emergency_numbers_are_never_dialled():
    for bad in ("+1911", "+112", "+1201555", "555 0100", "+1 212 555 0100", "12125550100"):
        case = make_case(hotline=bad)
        assert "bad_number" in [r for r, _ in policy.suppression_reasons(case, BUSINESS_TUESDAY)], bad


def test_premium_rate_is_blocked_and_region_must_match():
    assert [r for r, _ in policy.destination_problems("+19005550100", "US")] == ["blocked_number"]
    assert [r for r, _ in policy.destination_problems("+12129765555", "US")] == ["blocked_number"]
    assert [r for r, _ in policy.destination_problems("+12125550100", "GB")] == ["region_mismatch"]
    assert [r for r, _ in policy.destination_problems("+12125550100", "ZZ")] == ["unsupported_region"]
    assert [r for r, _ in policy.destination_problems("+11125550100", "US")] == ["bad_number"]   # area code must be 2-9
    assert policy.destination_problems("+442079460000", "GB") == []
    assert policy.destination_problems("+85221234567", "HK") == []


def test_pending_promise_holds_the_chase():
    case = make_case()
    case["next_call_after"] = (BUSINESS_TUESDAY + timedelta(days=3)).isoformat()
    assert "promise_pending" in [r for r, _ in policy.suppression_reasons(case, BUSINESS_TUESDAY)]


def test_next_call_after_uses_promise_plus_grace():
    assert policy.next_call_after("2026-09-09", BUSINESS_TUESDAY).startswith("2026-09-11")


# ---- plan ---------------------------------------------------------------------------------

def test_task_contains_case_facts_and_every_boundary():
    task = build_task(make_case())
    for needle in ("EXAMPLE-CLAIM-0001", "Example Home Insurance", "Alex Example", "press 2 then 3"):
        assert needle in task
    for boundary in policy.HARD_BOUNDARIES:
        assert boundary in task
    assert "supervisor" not in task.lower().split("rules you must follow")[0]


def test_escalated_task_asks_for_supervisor():
    case = make_case()
    case["escalation_level"] = 1
    assert "supervisor" in build_task(case).lower()


def test_request_shape_matches_calls_api():
    req = build_request(make_case(), "key-1")
    assert set(req) == {"task", "recipients", "result_schema", "metadata"}
    assert req["recipients"][0]["phones"] == ["+12125550100"]
    assert req["result_schema"] is RESULT_SCHEMA
    assert req["result_schema"]["additionalProperties"] is False


# ---- engine with the fake server ------------------------------------------------------------

def run(ledger, case, scenario, fake, force=True):
    client = CalleClient("test", fake.base_url, allow_local_fake=True)
    return engine.run_cycle(ledger, case["id"], "fixture", client=client, fixture_scenario=scenario, force=force)


def test_first_call_records_a_dated_commitment(ledger, fake):
    case = make_case(); ledger.upsert(case)
    res = run(ledger, case, "first_call_commitment", fake)
    assert res["placed"] and res["call"]["disposition"] == "chase_later"
    c = ledger.get(case["id"])
    assert c["status"] == "waiting_on_company"
    assert c["commitments"][0]["by_date"] == "2026-09-09"
    assert c["commitments"][0]["quote"] == "You should see the payment within five business days."
    assert c["ivr_path_learned"] == "2, 3, say 'existing claim'"
    assert c["next_call_after"].startswith("2026-09-11")
    assert c["calls"][0]["hotline_masked"] == "+1***00"


def test_broken_commitment_escalates_and_reaches_supervisor(ledger, fake):
    case = make_case(); ledger.upsert(case)
    run(ledger, case, "first_call_commitment", fake)
    c = ledger.get(case["id"])
    c["commitments"][0]["by_date"] = "2026-08-20"          # promise is now long overdue
    c["next_call_after"] = None
    ledger.upsert(c)
    broken = engine.check_broken_commitments(c)
    assert len(broken) == 1 and c["escalation_level"] == 1
    ledger.upsert(c)
    task = build_task(c)
    assert "BROKEN COMMITMENT" in task and "supervisor" in task.lower()
    res = run(ledger, c, "broken_promise_supervisor", fake)
    c = ledger.get(case["id"])
    assert res["call"]["structured_result"]["representative"].startswith("Daniel")
    assert [k["status"] for k in c["commitments"]] == ["broken", "pending"]


def test_offer_stops_at_a_human_and_decision_is_carried_forward(ledger, fake):
    case = make_case(case_type="refund", reference="EXAMPLE-REFUND-0002"); ledger.upsert(case)
    res = run(ledger, case, "offer_made", fake)
    c = ledger.get(case["id"])
    assert res["call"]["disposition"] == "needs_human" and c["status"] == "needs_human"
    assert "goodwill credit of 60 dollars" in c["pending_question"]
    assert "needs_human" in [r for r, _ in policy.suppression_reasons(c, BUSINESS_TUESDAY)]
    engine.record_decision(ledger, case["id"], "Decline the credit; insist on the full 140 dollar refund.")
    c = ledger.get(case["id"])
    assert c["status"] == "open" and "Decline the credit" in build_task(c)


def test_resolved_closes_the_case_and_keeps_commitments(ledger, fake):
    case = make_case(); ledger.upsert(case)
    run(ledger, case, "first_call_commitment", fake)
    run(ledger, case, "resolved", fake)
    c = ledger.get(case["id"])
    assert c["status"] == "resolved" and c["closed_at"]
    assert c["commitments"][0]["status"] == "kept"
    assert "case_closed" in [r for r, _ in policy.suppression_reasons(c, BUSINESS_TUESDAY)]


def test_customer_action_and_identity_refusal_do_not_loop(ledger, fake):
    case = make_case(); ledger.upsert(case)
    run(ledger, case, "needs_customer_action", fake)
    c = ledger.get(case["id"])
    assert c["status"] == "waiting_on_customer"
    assert "waiting_on_customer" in [r for r, _ in policy.suppression_reasons(c, BUSINESS_TUESDAY)]
    case2 = make_case(); ledger.upsert(case2)
    run(ledger, case2, "identity_refused", fake)
    c2 = ledger.get(case2["id"])
    assert c2["status"] == "needs_human" and "authorise" in c2["pending_question"]


def test_unreached_schedules_a_retry(ledger, fake):
    case = make_case(); ledger.upsert(case)
    res = run(ledger, case, "unreached_voicemail", fake)
    c = ledger.get(case["id"])
    assert res["call"]["disposition"] == "retry" and c["status"] == "open" and c["next_call_after"]


GOOD_RESULT = {"outcome": "in_progress", "status_statement": "In review.", "reference_number": "", "representative": "",
               "commitment_action": "", "commitment_by_date": "", "commitment_quote": "", "customer_action_required": "",
               "offer_quote": "", "ivr_path": "", "needs_human": False, "needs_human_reason": ""}


def test_schema_validation_is_complete_and_closed():
    assert engine.validate_result(dict(GOOD_RESULT)) == []
    assert engine.validate_result({"outcome": "paid"}) != []
    assert "no structured result" in engine.validate_result(None)
    assert "no structured result" in engine.validate_result("text")
    assert any(p.startswith("unexpected field") for p in engine.validate_result({**GOOD_RESULT, "extra": 1}))
    assert "status_statement must be a string" in engine.validate_result({**GOOD_RESULT, "status_statement": 5})
    assert "needs_human must be a boolean" in engine.validate_result({**GOOD_RESULT, "needs_human": 1})
    assert "needs_human must be a boolean" in engine.validate_result({**GOOD_RESULT, "needs_human": "true"})
    assert any("commitment_by_date" in p for p in engine.validate_result({**GOOD_RESULT, "commitment_by_date": "next week"}))
    assert any("commitment_by_date" in p for p in engine.validate_result({**GOOD_RESULT, "commitment_by_date": "2026-09-09T10:00"}))
    assert any("bad outcome" in p for p in engine.validate_result({**GOOD_RESULT, "outcome": "paid"}))


def test_unusable_and_unknown_results_stop_at_a_human_not_a_retry(ledger):
    case = make_case()
    rec = {"id": "call_x", "structured_result": {**GOOD_RESULT, "needs_human": "yes"}}
    engine.apply_result(case, rec)
    assert case["status"] == "needs_human" and rec["disposition"] == "unusable" and case["next_call_after"] is None
    assert "needs_human" in [r for r, _ in policy.suppression_reasons(case, BUSINESS_TUESDAY)]
    case = make_case()
    rec = {"id": "call_y", "structured_result": {**GOOD_RESULT, "outcome": "unknown"}}
    engine.apply_result(case, rec)
    assert case["status"] == "needs_human" and rec["disposition"] == "unknown" and case["next_call_after"] is None


def test_idempotency_key_stops_duplicate_calls(ledger, fake):
    case = make_case(); ledger.upsert(case)
    client = CalleClient("test", fake.base_url, allow_local_fake=True)
    req = build_request(case, "k"); key = "casechaser-dup-test"
    a = client.create_call(req, key); b = client.create_call(req, key)
    assert a["id"] == b["id"]


def test_suppression_blocks_without_force(ledger, fake):
    case = make_case(); ledger.upsert(case)
    run(ledger, case, "first_call_commitment", fake)
    res = run(ledger, case, "first_call_commitment", fake, force=False)
    assert res["placed"] is False and ("too_soon" in res["reason"] or "promise_pending" in res["reason"] or "daily_cap" in res["reason"])


def test_evidence_pack_quotes_commitments(ledger, fake):
    case = make_case(); ledger.upsert(case)
    run(ledger, case, "first_call_commitment", fake)
    text = engine.evidence_pack(ledger.get(case["id"]))
    assert "You should see the payment within five business days." in text
    assert "+1***00" in text and "+12125550100" not in text


def test_live_mode_requires_key():
    with pytest.raises(Exception):
        CalleClient("")


# ---- live gates ---------------------------------------------------------------------------------

def test_client_only_talks_to_official_origin_or_loopback_fake():
    from casechaser.client import OFFICIAL_ORIGIN, CalleError
    assert CalleClient("k").base_url == OFFICIAL_ORIGIN
    assert CalleClient("k", "http://127.0.0.1:8791", allow_local_fake=True).base_url == "http://127.0.0.1:8791"
    for bad in ("http://api.heycall-e.com", "https://api.heycall-e.com.evil.example", "https://api.heycall-e.com/v1",
                "http://127.0.0.1:8791", "https://evil.example", "http://169.254.169.254"):
        with pytest.raises(CalleError):
            CalleClient("k", bad)
    with pytest.raises(CalleError):
        CalleClient("k", "http://evil.example", allow_local_fake=True)


def test_live_force_is_refused(ledger):
    case = make_case(); ledger.upsert(case)
    with pytest.raises(ValueError):
        engine.run_cycle(ledger, case["id"], "live", client=CalleClient("k"), force=True)


def test_live_requires_exact_authorization(ledger, fake):
    case = make_case(); ledger.upsert(case)
    client = CalleClient("k", fake.base_url, allow_local_fake=True)   # stands in for the API; must never be reached
    before = len(fake.calls)
    res = engine.run_cycle(ledger, case["id"], "live", client=client)
    assert res["placed"] is False and ("quiet_hours" in res["reason"] or "not authorized" in res["reason"])
    auth = engine.new_authorization(case, "2099-01-01", 2, unattended=False)
    assert engine.authorization_problems(case, auth, unattended=False, now_utc=BUSINESS_TUESDAY) == []
    assert engine.authorization_problems(case, auth, unattended=True, now_utc=BUSINESS_TUESDAY) == ["authorization does not permit unattended (scheduled) runs"]
    other = make_case(hotline="+12125550101"); ledger.upsert(other)
    assert any("authorized destination" in p for p in engine.authorization_problems(other, {**auth, "case_id": other["id"]}, False, BUSINESS_TUESDAY))
    assert any("expired" in p for p in engine.authorization_problems(case, {**auth, "expires_on": "2020-01-01"}, False, BUSINESS_TUESDAY))
    assert any("budget" in p for p in engine.authorization_problems(case, {**auth, "calls_used": 2}, False, BUSINESS_TUESDAY))
    with pytest.raises(ValueError):
        engine.new_authorization(make_case(hotline="+1201555"), "2099-01-01", 1, False)
    assert len(fake.calls) == before


def test_pending_call_blocks_until_reconciled(ledger, fake):
    case = make_case(); ledger.upsert(case)
    client = CalleClient("test", fake.base_url, allow_local_fake=True)

    class Dies(CalleClient):
        def wait(self, call_id, **kw):
            raise RuntimeError("process died mid-poll")

    dying = Dies("test", fake.base_url, allow_local_fake=True)
    with pytest.raises(RuntimeError):
        engine.run_cycle(ledger, case["id"], "fixture", client=dying, fixture_scenario="first_call_commitment", force=True)
    c = ledger.get(case["id"])
    assert c["pending_call"] and c["pending_call"]["call_id"] and c["calls"] == []
    assert "pending_reconciliation" in [r for r, _ in policy.suppression_reasons(c, BUSINESS_TUESDAY)]
    res = engine.run_cycle(ledger, case["id"], "fixture", client=client, fixture_scenario="first_call_commitment", force=False)
    assert res["placed"] is False and "pending_reconciliation" in res["reason"]
    before = len(fake.calls)
    res = engine.reconcile(ledger, case["id"], client=client)
    c = ledger.get(case["id"])
    assert res["placed"] and res["reason"] == "reconciled" and len(c["calls"]) == 1 and c["pending_call"] is None
    assert len(fake.calls) == before                 # reconciliation fetched; it did not dial again
    assert c["commitments"][0]["by_date"] == "2026-09-09"


def test_idempotency_keys_are_unique_per_attempt():
    assert engine.idempotency_key() != engine.idempotency_key()


def test_dashboard_refuses_non_loopback_and_unmarked_posts(tmp_path):
    import threading, urllib.request, urllib.error, json as js
    from casechaser import dashboard
    with pytest.raises(SystemExit):
        dashboard.serve(str(tmp_path), "0.0.0.0", 0, FIXTURES)
    from http.server import ThreadingHTTPServer
    # drive the handler directly on an ephemeral loopback port
    captured = {}
    orig = ThreadingHTTPServer.serve_forever

    def grab(self, *a, **k):
        captured["srv"] = self; orig(self, *a, **k)
    ThreadingHTTPServer.serve_forever = grab
    t = threading.Thread(target=dashboard.serve, args=(str(tmp_path), "127.0.0.1", 0, FIXTURES), daemon=True); t.start()
    import time
    for _ in range(100):
        if "srv" in captured: break
        time.sleep(0.02)
    ThreadingHTTPServer.serve_forever = orig
    port = captured["srv"].server_address[1]
    base = f"http://127.0.0.1:{port}"
    assert urllib.request.urlopen(base + "/api/cases").status == 200
    req = urllib.request.Request(base + "/api/cases", headers={"Host": "attacker.example"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403
    body = js.dumps({"case": "x", "mode": "fixture"}).encode()
    req = urllib.request.Request(base + "/api/run", data=body, method="POST", headers={"Content-Type": "application/json"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403
    req = urllib.request.Request(base + "/api/run", data=js.dumps({"case": "x", "mode": "live"}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-CaseChaser": "dashboard"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403
    page = urllib.request.urlopen(base + "/").read().decode()
    assert "onclick=\"sel=" not in page and "data-id=" in page
    captured["srv"].shutdown()
