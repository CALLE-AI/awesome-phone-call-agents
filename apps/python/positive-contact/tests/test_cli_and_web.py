"""The gates on live mode, and the three dashboard pages."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from positive_contact.cli import build_parser, execute_run, main, seed_ledger
from positive_contact.config import (
    LIVE_CONFIRMATION_FLAG,
    OFFICIAL_CALLE_BASE_URL,
    ConfigError,
    RunMode,
    load_settings,
)
from positive_contact.dispatch import LiveCallBudget
from positive_contact.escalate import approve_field_visit, seed_first_step
from positive_contact.models import IntentState
from positive_contact.policy import QuietHours, load_policy
from positive_contact.transports.fixture import FixtureTransport
from positive_contact.web.app import _drain_once, create_app
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION
from tests.conftest import EVENT_PATH, ROSTER_PATH, SCENARIOS


# -- the live gates ----------------------------------------------------------------


def test_fixture_is_the_default_mode():
    assert load_settings(env={}).mode is RunMode.FIXTURE


def test_live_without_the_confirmation_flag_is_refused():
    with pytest.raises(ConfigError, match=LIVE_CONFIRMATION_FLAG):
        load_settings(mode="live", max_calls=3, env={"CALLE_API_KEY": "k"})


def test_live_without_a_max_calls_ceiling_is_refused():
    with pytest.raises(ConfigError, match="--max-calls"):
        load_settings(mode="live", live_confirmed=True, env={"CALLE_API_KEY": "k"})


def test_live_without_an_api_key_is_refused():
    with pytest.raises(ConfigError, match="CALLE_API_KEY"):
        load_settings(mode="live", live_confirmed=True, max_calls=1, env={})


def test_live_with_all_three_gates_is_allowed():
    settings = load_settings(
        mode="live", live_confirmed=True, max_calls=2, env={"CALLE_API_KEY": "k"}
    )
    assert settings.places_real_calls
    assert settings.max_calls == 2
    assert settings.base_url == OFFICIAL_CALLE_BASE_URL


def test_a_zero_max_calls_is_refused():
    with pytest.raises(ConfigError, match="at least 1"):
        load_settings(
            mode="live", live_confirmed=True, max_calls=0, env={"CALLE_API_KEY": "k"}
        )


def test_live_credentials_may_only_go_to_the_official_origin():
    with pytest.raises(ConfigError, match="official API origin"):
        load_settings(
            mode="live",
            live_confirmed=True,
            max_calls=1,
            env={"CALLE_API_KEY": "k", "PC_BASE_URL": "https://evil.test"},
        )


def test_a_ceiling_supplied_outside_live_mode_is_dropped():
    assert load_settings(mode="fixture", max_calls=99, env={}).max_calls is None


def test_an_unknown_mode_is_refused():
    with pytest.raises(ConfigError, match="unknown mode"):
        load_settings(mode="pretend", env={})


def test_judge_c_is_off_unless_the_env_var_is_set():
    assert load_settings(env={}).judge_c_enabled is False


# -- the parser --------------------------------------------------------------------


def test_the_run_command_exposes_all_three_live_gates():
    parser = build_parser()
    args = parser.parse_args(
        ["run", "--mode", "live", "--max-calls", "3", LIVE_CONFIRMATION_FLAG]
    )
    assert args.mode == "live"
    assert args.max_calls == 3
    assert args.i_understand_this_places_real_calls is True


def test_run_defaults_to_no_live_flags():
    args = build_parser().parse_args(["run"])
    assert args.mode is None
    assert args.max_calls is None
    assert args.i_understand_this_places_real_calls is False


def test_the_serve_command_exposes_the_live_ceiling_and_confirmation():
    args = build_parser().parse_args(
        ["serve", "--mode", "live", "--max-calls", "4", LIVE_CONFIRMATION_FLAG]
    )
    assert args.mode == "live"
    assert args.max_calls == 4
    assert args.i_understand_this_places_real_calls is True


def test_every_documented_command_exists():
    parser = build_parser()
    for command in ("preflight", "run", "serve", "report", "approve-field-visits", "record"):
        assert parser.parse_args(
            [command, *(["call_1", "--contact-id", "c", "--ladder-step", "1"]
                        if command == "record" else []),
             *(["--approved-by", "op"] if command == "approve-field-visits" else [])]
        )


# -- the CLI end to end ------------------------------------------------------------


def test_preflight_exits_zero_on_the_demo_roster(capsys):
    code = main(["preflight", "--event", str(EVENT_PATH), "--roster", str(ROSTER_PATH)])
    assert code == 0
    assert "PositiveContact preflight" in capsys.readouterr().out


def test_preflight_exits_non_zero_on_a_bad_roster(tmp_path, capsys):
    roster = tmp_path / "bad.csv"
    roster.write_text(
        "contact_id,first_name,phone_e164,alt_phone_e164,locale,tz,service_address_short\n"
        "pc-1,Sam,4155550190,,en-US,America/Los_Angeles,9 block of Test St\n",
        encoding="utf-8",
    )
    assert main(["preflight", "--event", str(EVENT_PATH), "--roster", str(roster)]) == 1


def test_run_in_fixture_mode_completes_and_prints_the_report(tmp_path, capsys):
    code = main(
        [
            "run",
            "--mode", "fixture",
            "--event", str(EVENT_PATH),
            "--roster", str(ROSTER_PATH),
            "--db", str(tmp_path / "run.db"),
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "Positive contact confirmed" in out
    assert "of 9 live reached" in out
    assert "Calls placed" in out


def test_run_refuses_live_mode_without_the_gates(tmp_path, capsys):
    code = main(
        [
            "run",
            "--mode", "live",
            "--event", str(EVENT_PATH),
            "--roster", str(ROSTER_PATH),
            "--db", str(tmp_path / "run.db"),
        ]
    )
    assert code == 2
    assert "confirmation flag" in capsys.readouterr().err


def test_serve_refuses_live_mode_without_the_gates(tmp_path, capsys):
    code = main(
        [
            "serve",
            "--mode",
            "live",
            "--event",
            str(EVENT_PATH),
            "--db",
            str(tmp_path / "serve.db"),
        ]
    )
    assert code == 2
    assert "confirmation flag" in capsys.readouterr().err


def test_worker_dispatches_due_intents_under_the_shared_budget(
    ledger, demo_preflight, fixture_transport, policy
):
    moment = datetime.now(timezone.utc)
    future_event = demo_preflight.event.model_copy(
        update={
            "window_start": moment + timedelta(hours=8),
            "window_end": moment + timedelta(hours=20),
            "field_visit_cutoff": moment + timedelta(hours=6),
        }
    )
    ledger.put_event(future_event)
    contact = demo_preflight.callable_contacts[0]
    ledger.put_contact(contact)
    worker_policy = replace(policy, quiet_hours=QuietHours(time(0), time(0)))
    seed_first_step(
        ledger,
        future_event,
        worker_policy,
        contact.contact_id,
        now=moment - timedelta(seconds=1),
        task_version=TASK_VERSION,
        schema_version=SCHEMA_VERSION,
    )
    budget = LiveCallBudget(1)
    _drain_once(
        ledger, fixture_transport, future_event, worker_policy, None, budget
    )
    assert ledger.count_calls_for_event(future_event.event_id) == 1
    assert budget.spent == 1


def test_report_command_renders_every_format(tmp_path, capsys):
    db = tmp_path / "run.db"
    main(["run", "--mode", "fixture", "--event", str(EVENT_PATH),
          "--roster", str(ROSTER_PATH), "--db", str(db)])
    capsys.readouterr()
    for fmt, needle in (("md", "| Metric |"), ("csv", "metric,value,denominator"),
                        ("json", '"counts"')):
        assert main(["report", "--event", str(EVENT_PATH), "--db", str(db),
                     "--format", fmt]) == 0
        assert needle in capsys.readouterr().out


def test_approve_field_visits_requires_an_approver():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["approve-field-visits", "--all"])


def test_approve_field_visits_exports_masked_rows(tmp_path, capsys):
    from positive_contact.redact import find_raw_e164

    db = tmp_path / "run.db"
    main(["run", "--mode", "fixture", "--event", str(EVENT_PATH),
          "--roster", str(ROSTER_PATH), "--db", str(db)])
    capsys.readouterr()
    code = main(["approve-field-visits", "--event", str(EVENT_PATH), "--db", str(db),
                 "--all", "--approved-by", "op-7"])
    assert code == 0
    out = capsys.readouterr().out
    assert "approved wo:" in out
    assert find_raw_e164(out) == []


def test_replay_mode_runs_offline_and_states_its_provenance(tmp_path, capsys):
    code = main(["run", "--mode", "replay", "--event", str(EVENT_PATH),
                 "--roster", str(ROSTER_PATH), "--db", str(tmp_path / "replay.db")])
    assert code == 0
    out = capsys.readouterr().out
    assert "replaying" in out


# -- the dashboard -----------------------------------------------------------------


@pytest.fixture
def dashboard(ledger, demo_preflight, event, policy, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    return TestClient(create_app(ledger.db_path, event, policy)), ledger


def test_the_root_redirects_to_the_board(dashboard):
    client, _ledger = dashboard
    response = client.get("/", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/board"


@pytest.mark.parametrize("path", ["/board", "/review", "/support", "/reports"])
def test_every_page_renders(dashboard, path):
    client, _ledger = dashboard
    response = client.get(path)
    assert response.status_code == 200
    assert "PositiveContact" in response.text


@pytest.mark.parametrize(
    "path", ["/board/rows", "/review/rows", "/support/rows", "/reports/table"]
)
def test_every_polled_partial_renders(dashboard, path):
    client, _ledger = dashboard
    assert client.get(path).status_code == 200


def test_the_board_shows_one_row_per_contact(dashboard):
    client, ledger = dashboard
    text = client.get("/board").text
    for contact in ledger.list_contacts("psps-demo-2026-09"):
        assert contact.contact_id in text


def test_the_board_marks_the_contact_that_was_never_dialled(dashboard):
    client, _ledger = dashboard
    text = client.get("/board").text
    assert "NOT DIALLED" in text
    assert "unsupported_locale_bilingual_callback" in text


def test_the_review_queue_shows_the_evidence_spans(dashboard):
    client, _ledger = dashboard
    text = client.get("/review").text
    assert "medical_question_priority_review" in text
    assert "transcript_acknowledgement" in text or "structured_result" in text


def test_the_review_queue_explains_that_the_deadline_keeps_running(dashboard):
    client, _ledger = dashboard
    assert "The deadline is not" in client.get("/review").text


def test_review_forms_have_visible_accessible_labels(dashboard):
    client, _ledger = dashboard
    text = client.get("/review").text
    assert '<label class="field"' in text
    assert "Confirmation evidence" in text
    assert "Refusal evidence" in text


def test_health_and_public_status_endpoints(dashboard):
    client, _ledger = dashboard
    assert client.get("/healthz").json()["status"] == "ok"
    status_payload = client.get("/api/v1/status").json()
    assert status_payload["event_id"] == "psps-demo-2026-09"
    assert status_payload["summary"]["contacts"] == 12


def test_support_desk_authorizes_and_completes_the_fixture_provider_call(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    request = ledger.list_support_requests(event.event_id)[0]
    client = TestClient(create_app(ledger.db_path, event, policy, transport=transport))
    response = client.post(
        f"/support/{request.request_id}/authorize",
        data={
            "actor": "op-7",
            "provider_id": "demo-equipment",
            "confirm_provider_call": "yes",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303
    refreshed = ledger.get_support_request(request.request_id)
    assert refreshed is not None
    assert refreshed.state.value == "COMPLETED"
    page = client.get("/support").text
    assert "Provider result" in page
    assert "Within two hours" in page


def test_support_api_is_masked_and_omits_provider_phone(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    client = TestClient(create_app(ledger.db_path, event, policy, transport=transport))
    payload = client.get("/api/v1/support-requests").text
    assert "+14155550109" not in payload
    assert "+14155550181" not in payload
    assert "•••" in payload


def test_cross_origin_operator_action_is_denied(dashboard):
    client, ledger = dashboard
    intent = ledger.list_intents("psps-demo-2026-09", [IntentState.NEEDS_HUMAN])[0]
    response = client.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "confirmed"},
        headers={"Origin": "https://evil.example"},
        follow_redirects=False,
    )
    assert response.status_code == 403
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN


def test_public_operator_action_requires_a_configured_token(dashboard):
    _client, ledger = dashboard
    intent = ledger.list_intents("psps-demo-2026-09", [IntentState.NEEDS_HUMAN])[0]
    stored_event = ledger.get_event("psps-demo-2026-09")
    assert stored_event is not None
    public = TestClient(
        create_app(ledger.db_path, stored_event, load_policy(stored_event.policy)),
        base_url="https://demo.example",
    )
    response = public.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "confirmed"},
        follow_redirects=False,
    )
    assert response.status_code == 503


def test_configured_operator_token_uses_http_basic(
    ledger, demo_preflight, event, policy, now
):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    intent = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])[0]
    client = TestClient(
        create_app(ledger.db_path, event, policy, operator_token="test-secret"),
        base_url="https://demo.example",
    )
    denied = client.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "confirmed"},
        follow_redirects=False,
    )
    assert denied.status_code == 401
    allowed = client.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "confirmed"},
        auth=("operator", "test-secret"),
        follow_redirects=False,
    )
    assert allowed.status_code == 303


def test_a_confirmation_without_evidence_is_rejected(dashboard):
    client, ledger = dashboard
    intent = ledger.list_intents("psps-demo-2026-09", [IntentState.NEEDS_HUMAN])[0]
    response = client.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "   "},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN


def test_a_confirmation_with_evidence_is_recorded(dashboard):
    client, ledger = dashboard
    intent = ledger.list_intents("psps-demo-2026-09", [IntentState.NEEDS_HUMAN])[0]
    response = client.post(
        f"/review/{intent.intent_id}/confirm",
        data={"actor": "op-7", "evidence": "Yes, I heard you."},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert ledger.reconstruct(intent.intent_id) is IntentState.CONFIRMED


def test_the_reports_page_shows_pending_field_visits(ledger, demo_preflight, event,
                                                     policy, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    client = TestClient(create_app(ledger.db_path, event, policy))
    text = client.get("/reports").text
    assert "pending approval" in text
    assert "Approve this field visit" in text


def test_approving_a_field_visit_from_the_dashboard(ledger, demo_preflight, event,
                                                    policy, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    client = TestClient(create_app(ledger.db_path, event, policy))
    order = ledger.list_work_orders(event.event_id)[0]
    response = client.post(
        f"/field-visits/{order.work_order_id}/approve",
        data={"actor": "op-7"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    refreshed = {item.work_order_id: item for item in ledger.list_work_orders(event.event_id)}
    assert refreshed[order.work_order_id].approved_by == "op-7"


# -- the mid-event view ------------------------------------------------------------


def test_stop_before_cutoff_leaves_the_review_queue_populated(tmp_path, capsys):
    """The full run sweeps everything to the field-visit queue, which is correct and
    leaves nothing to review. An operator mid-event needs the other view."""
    db = tmp_path / "mid.db"
    assert main([
        "run", "--mode", "fixture", "--event", str(EVENT_PATH),
        "--roster", str(ROSTER_PATH), "--db", str(db), "--stop-before-cutoff",
    ]) == 0
    capsys.readouterr()

    from positive_contact.ledger import Ledger
    from positive_contact.preflight import load_event

    event, policy = load_event(EVENT_PATH)
    ledger = Ledger(db)
    try:
        open_items = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])
        assert len(open_items) == 3  # medical question, wrong number, refusal
        # The ladder still ran to completion for everyone it could confirm.
        confirmed = [
            intent for intent in ledger.list_intents(event.event_id)
            if ledger.reconstruct(intent.intent_id) is IntentState.CONFIRMED
        ]
        assert len(confirmed) == 7
        # Nothing was swept early.
        assert ledger.list_work_orders(event.event_id) == [] or all(
            order.reason_code != "field_visit_cutoff_reached_while_open"
            for order in ledger.list_work_orders(event.event_id)
        )
    finally:
        ledger.close()


def test_the_full_run_still_sweeps_to_the_cutoff(tmp_path, capsys):
    db = tmp_path / "full.db"
    assert main([
        "run", "--mode", "fixture", "--event", str(EVENT_PATH),
        "--roster", str(ROSTER_PATH), "--db", str(db),
    ]) == 0
    capsys.readouterr()

    from positive_contact.ledger import Ledger
    from positive_contact.preflight import load_event

    event, _policy = load_event(EVENT_PATH)
    ledger = Ledger(db)
    try:
        assert ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN]) == []
        assert len(ledger.list_work_orders(event.event_id)) == 5
    finally:
        ledger.close()
