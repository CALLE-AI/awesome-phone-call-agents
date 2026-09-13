"""Demo server tests. The bank decides automatically -- the amount
threshold decides whether verification is required at all, and if so a
recorded scenario is picked for it -- never a customer- or operator-driven
choice. These tests focus on: that automatic decision, that the real
resolve.classify()/decide() run underneath (not fake logic), that every
result is marked advisory and human-review-required, that this server has
no live-call path at all, and that a non-loopback bind cannot run
unauthenticated.
"""

import ast
import json
import threading
import time
import urllib.error
import urllib.request
from http.client import HTTPResponse
from pathlib import Path

import pytest

from ringfence import demo_server
from ringfence.demo_server import (
    AUTO_APPROVE_BELOW_AMOUNT,
    DEMO_TOKEN_ENV,
    NO_VERIFICATION_REQUIRED,
    DemoStore,
    create_server,
    handle_get,
    handle_list,
    handle_list_scenarios,
    handle_submit,
    is_loopback_host,
    load_scenarios,
    main,
    token_is_valid,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
_SMALL_AMOUNT = f"{AUTO_APPROVE_BELOW_AMOUNT - 1:.2f}"
_LARGE_AMOUNT = f"{AUTO_APPROVE_BELOW_AMOUNT + 1000:.2f}"
_ADVISORY_RECOMMENDATIONS = ("ADVISE_ALLOW", "ADVISE_BLOCK", "ESCALATE_TO_HUMAN")


@pytest.fixture
def scenarios():
    return load_scenarios(FIXTURES_DIR)


def test_load_scenarios_finds_every_fixture(scenarios):
    assert len(scenarios) == len(list(FIXTURES_DIR.glob("*.json")))
    assert "13_scam_ceo_fraud_secrecy_and_urgency" in scenarios


def test_list_scenarios_gives_every_scenario_a_plain_text_label_and_its_own_category(scenarios):
    # Labels are plain text -- no emoji baked in. The frontend renders an
    # icon from `category` instead, so category has to actually be present
    # and correct on every scenario.
    status, payload = handle_list_scenarios(scenarios)
    assert status == 200
    assert len(payload["scenarios"]) == len(scenarios)
    for item in payload["scenarios"]:
        assert item["label"]
        assert item["label"].isascii()
        assert item["key"] in scenarios
        assert item["category"] == scenarios[item["key"]]["category"]


def test_every_case_record_carries_a_category_for_icon_selection(scenarios):
    store = DemoStore()

    _, below_threshold = handle_submit(
        store, scenarios, {"account_holder_name": "A", "claimed_transaction_amount": _SMALL_AMOUNT},
    )
    assert below_threshold["category"] == "no_verification_required"

    _, simulated = handle_submit(
        store, scenarios, {"account_holder_name": "B", "claimed_transaction_amount": _LARGE_AMOUNT},
        delay_seconds=0.01,
    )
    assert simulated["category"] in ("scam_pattern", "clean_legitimate", "escalation_case")
    assert simulated["scenario_label"].isascii()


def test_small_amount_needs_no_verification_and_makes_no_recommendation(scenarios):
    store = DemoStore()
    status, record = handle_submit(
        store, scenarios,
        {"account_holder_name": "Jordan Rivera", "claimed_transaction_amount": _SMALL_AMOUNT},
    )
    assert status == 201
    assert record["status"] == "resolved"  # no pending state at all -- resolved immediately
    # No call happened, so this is the institution's own deterministic
    # threshold policy, not one of decide()'s heuristic recommendations.
    assert record["disposition"] == NO_VERIFICATION_REQUIRED
    assert record["disposition"] not in _ADVISORY_RECOMMENDATIONS
    assert record["requires_human_review"] is False
    assert record["scenario_key"] is None
    assert record["audit"] is None  # no call happened, so there's nothing to audit


def test_large_amount_runs_a_simulated_verification(scenarios):
    store = DemoStore()
    status, record = handle_submit(
        store, scenarios,
        {"account_holder_name": "New Customer", "claimed_transaction_amount": _LARGE_AMOUNT},
        delay_seconds=0.02,
    )
    assert status == 201
    assert record["status"] == "pending_verification_call"

    time.sleep(0.1)
    _, resolved = handle_get(store, record["id"])
    assert resolved["status"] == "resolved"
    assert resolved["scenario_key"] in scenarios
    assert resolved["disposition"] in _ADVISORY_RECOMMENDATIONS


def test_every_call_derived_recommendation_is_advisory_and_needs_human_review(scenarios):
    # The must-not-regress property: nothing this server produces from a
    # call interpretation may present as a completed financial action.
    store = DemoStore()
    _, record = handle_submit(
        store, scenarios,
        {"account_holder_name": "Someone", "claimed_transaction_amount": _LARGE_AMOUNT},
        delay_seconds=0.02,
    )
    assert record["advisory"] is True
    assert record["requires_human_review"] is True

    time.sleep(0.1)
    _, resolved = handle_get(store, record["id"])
    assert resolved["advisory"] is True
    assert resolved["requires_human_review"] is True
    assert resolved["disposition"].startswith(("ADVISE_", "ESCALATE_"))
    assert resolved["audit"]["disposition"]["advisory"] is True
    assert resolved["audit"]["disposition"]["requires_human_review"] is True


def test_the_customer_never_chooses_the_scenario_or_whether_to_call(scenarios):
    # No API surface accepts a customer-supplied scenario_key at all for a
    # normal submission -- confirmed by checking the bank's own random
    # pick lands in the real scenario set even when a bogus one is
    # supplied in the payload (it's simply ignored).
    store = DemoStore()
    status, record = handle_submit(
        store, scenarios,
        {
            "account_holder_name": "Someone", "claimed_transaction_amount": _LARGE_AMOUNT,
            "scenario_key": "not_a_real_scenario_a_customer_might_try_to_inject",
        },
        delay_seconds=0.02,
    )
    assert status == 201
    time.sleep(0.1)
    _, resolved = handle_get(store, record["id"])
    assert resolved["scenario_key"] in scenarios


def test_using_a_single_known_scenario_confirms_the_real_decision_engine_runs():
    # Restricting the scenario pool to exactly one fixture makes the
    # "random" pick deterministic, so this can assert a specific
    # recommendation end to end -- proving the demo runs the real engine,
    # not a hardcoded result.
    one_scenario = load_scenarios(FIXTURES_DIR)
    one_scenario = {"13_scam_ceo_fraud_secrecy_and_urgency": one_scenario["13_scam_ceo_fraud_secrecy_and_urgency"]}

    store = DemoStore()
    status, record = handle_submit(
        store, one_scenario,
        {
            "account_holder_name": "Taylor Doe", "claimed_recipient": "Some Vendor",
            "claimed_transaction_amount": _LARGE_AMOUNT,
        },
        delay_seconds=0.05,
    )
    assert status == 201

    time.sleep(0.2)
    _, resolved = handle_get(store, record["id"])
    assert resolved["status"] == "resolved"
    assert resolved["disposition"] == "ADVISE_BLOCK"
    assert "secrecy_demand_present" in resolved["disposition_reasons"]
    assert resolved["audit"]["verification_qa"]
    # The audit trail reflects what was actually typed into the demo form,
    # not the fixture author's own placeholder case details.
    assert resolved["audit"]["account_holder_name"] == "Taylor Doe"
    assert resolved["audit"]["claimed_recipient"] == "Some Vendor"
    assert resolved["audit"]["claimed_transaction_amount"] == _LARGE_AMOUNT


def test_this_server_has_no_live_call_path_at_all():
    # Structural, not behavioural: the deployable surface must not even
    # contain the machinery for a real call, so there is nothing to
    # accidentally re-enable with an environment variable.
    tree = ast.parse(Path(demo_server.__file__).read_text(encoding="utf-8"))
    # Strip docstrings (which legitimately *discuss* the absent live path)
    # so this checks real code; ast.unparse drops comments for the same
    # reason.
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            first = node.body[0] if node.body else None
            if (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)
            ):
                node.body.pop(0)
    code = ast.unparse(tree)
    for forbidden in ("CALLE_API_KEY", "CalleClient", "place_verification_call", "live_enabled"):
        assert forbidden not in code, f"demo_server must not reference {forbidden}"
    assert not hasattr(demo_server, "default_live_client_factory")


def test_a_phone_number_is_never_collected_or_stored(scenarios):
    # Even if a client sends one, nothing accepts it: there is no field to
    # read it into and no code to dial it.
    store = DemoStore()
    _, record = handle_submit(
        store, scenarios,
        {
            "account_holder_name": "Someone", "claimed_transaction_amount": _LARGE_AMOUNT,
            "on_file_phone": "+14155550199", "region": "US",
        },
        delay_seconds=0.02,
    )
    assert "+14155550199" not in json.dumps(record)

    time.sleep(0.1)
    _, resolved = handle_get(store, record["id"])
    assert "+14155550199" not in json.dumps(resolved)


def test_list_returns_all_cases_newest_first(scenarios):
    store = DemoStore()
    handle_submit(store, scenarios, {"account_holder_name": "A", "claimed_transaction_amount": _SMALL_AMOUNT})
    time.sleep(0.02)
    handle_submit(store, scenarios, {"account_holder_name": "B", "claimed_transaction_amount": _SMALL_AMOUNT})

    status, payload = handle_list(store)
    assert status == 200
    assert len(payload["cases"]) == 2
    assert payload["cases"][0]["submitted_at"] >= payload["cases"][1]["submitted_at"]


def test_get_unknown_case_id_is_404():
    store = DemoStore()
    status, payload = handle_get(store, "does_not_exist")
    assert status == 404
    assert payload["error"] == "not_found"


def test_token_check_is_a_no_op_only_when_no_token_is_configured():
    assert token_is_valid(None, None) is True
    assert token_is_valid("", None) is True
    assert token_is_valid("s3cret", None) is False
    assert token_is_valid("s3cret", "") is False
    assert token_is_valid("s3cret", "wrong") is False
    assert token_is_valid("s3cret", "s3cret") is True


def test_loopback_detection_covers_the_hosts_that_are_not_publicly_reachable():
    assert is_loopback_host("127.0.0.1")
    assert is_loopback_host("localhost")
    assert is_loopback_host("::1")
    assert not is_loopback_host("0.0.0.0")
    assert not is_loopback_host("10.0.0.7")


def test_a_public_bind_without_a_token_refuses_to_start(monkeypatch, capsys):
    monkeypatch.delenv(DEMO_TOKEN_ENV, raising=False)
    assert main(["--host", "0.0.0.0", "--port", "0"]) == 2
    assert "refusing to start" in capsys.readouterr().out


def _request(
    base: str, method: str, path: str, body: dict | None = None, token: str | None = None
) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token is not None:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        resp: HTTPResponse = urllib.request.urlopen(req, timeout=5)
        return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def _serve(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def test_http_round_trip_submit_then_list_and_get(scenarios):
    server = create_server(host="127.0.0.1", port=0, delay_seconds=0.05, scenarios=scenarios)
    thread = _serve(server)
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        status, record = _request(
            base, "POST", "/api/demo/cases",
            {"account_holder_name": "Jordan Rivera", "claimed_transaction_amount": _SMALL_AMOUNT},
        )
        assert status == 201
        assert record["status"] == "resolved"
        assert record["disposition"] == NO_VERIFICATION_REQUIRED

        status, listing = _request(base, "GET", "/api/demo/cases")
        assert status == 200
        assert len(listing["cases"]) == 1

        status, scenario_list = _request(base, "GET", "/api/demo/scenarios")
        assert status == 200
        assert len(scenario_list["scenarios"]) == len(scenarios)

        status, fetched = _request(base, "GET", f"/api/demo/cases/{record['id']}")
        assert status == 200
        assert fetched["status"] == "resolved"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_every_route_is_401_without_the_configured_token(scenarios):
    server = create_server(
        host="127.0.0.1", port=0, delay_seconds=0.05, scenarios=scenarios, demo_token="s3cret"
    )
    thread = _serve(server)
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        for method, path, body in (
            ("GET", "/", None),
            ("GET", "/bank", None),
            ("GET", "/api/demo/scenarios", None),
            ("GET", "/api/demo/cases", None),
            ("POST", "/api/demo/cases", {"claimed_transaction_amount": _SMALL_AMOUNT}),
        ):
            status, payload = _request(base, method, path, body)
            assert status == 401, f"{method} {path} was reachable without a token"
            assert payload["error"] == "unauthorized"

        status, payload = _request(base, "GET", "/api/demo/cases", token="wrong")
        assert status == 401

        # The health check is the one unauthenticated route, and says
        # nothing but "up".
        status, payload = _request(base, "GET", "/healthz")
        assert status == 200
        assert payload == {"status": "ok"}

        status, payload = _request(base, "GET", "/api/demo/cases", token="s3cret")
        assert status == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_a_query_parameter_token_authorizes_a_page_and_sets_a_cookie(scenarios):
    server = create_server(
        host="127.0.0.1", port=0, delay_seconds=0.05, scenarios=scenarios, demo_token="s3cret"
    )
    thread = _serve(server)
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with urllib.request.urlopen(f"{base}/?token=s3cret", timeout=5) as resp:
            assert resp.status == 200
            cookie = resp.headers.get("Set-Cookie") or ""
        assert "ringfence_demo_token=s3cret" in cookie
        assert "HttpOnly" in cookie

        req = urllib.request.Request(f"{base}/api/demo/cases")
        req.add_header("Cookie", "ringfence_demo_token=s3cret")
        with urllib.request.urlopen(req, timeout=5) as resp:
            assert resp.status == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
