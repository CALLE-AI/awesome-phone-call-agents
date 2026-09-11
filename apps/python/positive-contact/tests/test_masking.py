"""A raw E.164 belongs in exactly one place. This file fails the build if it escapes."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from positive_contact.cli import execute_run, seed_ledger
from positive_contact.escalate import approve_field_visit, operator_confirm
from positive_contact.models import IntentState
from positive_contact.preflight import render_preview
from positive_contact.redact import (
    DIGITS_REMOVED,
    EMAIL_REMOVED,
    find_raw_e164,
    mask_e164,
    mask_numbers_in_text,
    redact_free_text,
    redact_snapshot,
)
from positive_contact.report import build_report, work_orders_csv, work_orders_json
from positive_contact.transports.fixture import FixtureTransport
from positive_contact.web.app import create_app
from tests.conftest import ROSTER_PATH, SCENARIOS


def roster_numbers():
    import csv

    with ROSTER_PATH.open(newline="", encoding="utf-8") as handle:
        numbers = []
        for row in csv.DictReader(handle):
            for column in ("phone_e164", "alt_phone_e164"):
                if row.get(column):
                    numbers.append(row[column])
        return numbers


@pytest.fixture
def ran(ledger, demo_preflight, now):
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    outcome = execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=True)
    return outcome


# -- the masking primitive ---------------------------------------------------------


def test_the_documented_mask_format():
    assert mask_e164("+14155550142") == "+1415•••0142"


def test_masking_keeps_no_more_than_the_documented_digits():
    masked = mask_e164("+14155550142")
    assert "5555014" not in masked
    assert masked.startswith("+1415")
    assert masked.endswith("0142")


def test_masking_a_short_number_reveals_less_not_more():
    masked = mask_e164("+1234567")
    assert find_raw_e164(masked) == []
    assert len(masked.replace("•••", "")) <= 4


def test_masking_handles_a_missing_number():
    assert mask_e164(None) == "(no number)"
    assert mask_e164("") == "(no number)"


def test_numbers_inside_free_text_are_masked():
    masked = mask_numbers_in_text("Call +14155550142 or +14155550143 today")
    assert find_raw_e164(masked) == []
    assert "+1415•••0142" in masked and "+1415•••0143" in masked


def test_free_text_redaction_strips_digit_runs_and_emails():
    redacted = redact_free_text("account 998877665 or sam@example.com or +14155550142")
    assert DIGITS_REMOVED in redacted
    assert EMAIL_REMOVED in redacted
    assert "+1415•••0142" in redacted
    assert "998877665" not in redacted


def test_free_text_redaction_leaves_short_numbers_alone():
    assert "6 hours" in redact_free_text("the cutoff is 6 hours before")


def test_redaction_of_none_is_none():
    assert redact_free_text(None) is None


def test_snapshot_redaction_walks_nested_structures():
    payload = {
        "recipients": [{"phones": ["+14155550142"], "attempts": [{"phone": "+14155550142"}]}],
        "summary": "reached +14155550142",
    }
    redacted = redact_snapshot(payload)
    assert find_raw_e164(json.dumps(redacted)) == []


def test_snapshot_redaction_strips_health_email_and_long_digits():
    payload = {
        "transcript": "My oxygen model is 998877665; write sam@example.com",
    }
    redacted = json.dumps(redact_snapshot(payload))
    assert "oxygen" not in redacted.lower()
    assert "998877665" not in redacted
    assert "sam@example.com" not in redacted


def test_operator_evidence_is_redacted_before_the_append_only_log(
    ledger, demo_preflight, fixture_transport, event, policy, now
):
    seed_ledger(ledger, demo_preflight)
    execute_run(
        ledger,
        fixture_transport,
        demo_preflight,
        now=now,
        simulated_clock=False,
    )
    intent = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])[0]
    operator_confirm(
        ledger,
        intent,
        actor="op-7",
        evidence_text="Call +14155550142 about oxygen, 998877665, sam@example.com",
        now=now,
    )
    stored = json.dumps(ledger.list_transitions(intent.intent_id)[-1].evidence_refs)
    assert find_raw_e164(stored) == []
    assert "oxygen" not in stored.lower()
    assert "998877665" not in stored
    assert "sam@example.com" not in stored


# -- every operator-visible surface ------------------------------------------------


def test_the_preview_leaks_nothing(demo_preflight, now):
    rendered = render_preview(demo_preflight, now=now)
    assert find_raw_e164(rendered) == []
    for number in roster_numbers():
        assert number not in rendered


def test_the_run_log_leaks_nothing(ran):
    joined = "\n".join(ran.log)
    assert find_raw_e164(joined) == []
    for number in roster_numbers():
        assert number not in joined


def test_the_report_leaks_nothing(ledger, ran, event, now):
    report = build_report(ledger, event, now=now)
    for rendered in (report.to_markdown(), report.to_csv(), report.to_json()):
        assert find_raw_e164(rendered) == []


def test_the_work_order_export_leaks_nothing(ledger, ran, event, now):
    for order in ledger.list_work_orders(event.event_id):
        approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    for rendered in (work_orders_csv(ledger, event), work_orders_json(ledger, event)):
        assert find_raw_e164(rendered) == []
        for number in roster_numbers():
            assert number not in rendered


def test_the_transitions_table_leaks_nothing(ledger, ran, event):
    rows = ledger.all_transitions(event.event_id)
    serialised = json.dumps([row.model_dump(mode="json") for row in rows])
    assert find_raw_e164(serialised) == []
    for number in roster_numbers():
        assert number not in serialised


def test_the_dispositions_table_leaks_nothing(ledger, ran, event):
    items = ledger.list_dispositions(event.event_id)
    serialised = json.dumps([item.model_dump(mode="json") for item in items])
    assert find_raw_e164(serialised) == []


def test_the_stored_provider_snapshots_are_redacted(ledger, ran, event):
    for intent in ledger.list_intents(event.event_id):
        attempt = ledger.get_attempt(intent.intent_id)
        if attempt is None or attempt.raw_snapshot_redacted is None:
            continue
        assert find_raw_e164(json.dumps(attempt.raw_snapshot_redacted)) == []


def test_the_review_queue_leaks_nothing_while_it_has_rows(
    ledger, demo_preflight, event, policy, now
):
    """The other dashboard test runs the clock to the cutoff, which empties the review
    queue, so review-row masking went unchecked. This stops before the cutoff."""
    transport = FixtureTransport(SCENARIOS)
    seed_ledger(ledger, demo_preflight)
    execute_run(ledger, transport, demo_preflight, now=now, simulated_clock=False)
    open_items = ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN])
    assert open_items, "the review queue must have rows for this test to mean anything"

    client = TestClient(create_app(ledger.db_path, event, policy))
    text = client.get("/review").text
    assert "medical_question_priority_review" in text  # rows really rendered
    assert find_raw_e164(text) == []
    for number in roster_numbers():
        assert number not in text


def test_every_dashboard_page_leaks_nothing(ledger, ran, event, policy, tmp_path, now):
    for order in ledger.list_work_orders(event.event_id):
        approve_field_visit(ledger, event, order.work_order_id, actor="op-7", now=now)
    app = create_app(ledger.db_path, event, policy)
    client = TestClient(app)
    for path in ("/board", "/review", "/reports"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert find_raw_e164(response.text) == [], path
        for number in roster_numbers():
            assert number not in response.text, f"{number} leaked on {path}"


def test_the_contacts_table_is_the_only_place_the_raw_number_lives(ledger, ran):
    """Walk every table and prove the raw numbers appear in `contacts` and nowhere else."""
    tables = [
        row["name"]
        for row in ledger.conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    numbers = set(roster_numbers())
    found_in_contacts = False
    for table in tables:
        rows = ledger.conn.execute(f"SELECT * FROM {table}").fetchall()  # noqa: S608
        serialised = json.dumps([dict(row) for row in rows], default=str)
        leaked = numbers & set(find_raw_e164(serialised))
        if table == "contacts":
            found_in_contacts = bool(leaked)
        else:
            assert not leaked, f"{table} holds a raw number: {sorted(leaked)}"
    assert found_in_contacts, "the roster numbers should still be readable in contacts"
