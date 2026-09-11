"""Webhooks are wake-ups. The re-read is the evidence."""

from __future__ import annotations

import copy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from positive_contact.dispatch import dispatch_intent
from positive_contact.escalate import build_intent
from positive_contact.intake import (
    WEBHOOK_EVENT_ID_HEADER,
    WEBHOOK_PATH,
    WebhookReceiver,
    build_router,
    handle_terminal_call,
    process_inbox,
    verify_binding,
)
from positive_contact.models import Contact, IntentState, LadderTarget
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION


def webhook_payload(event_uid="evt_1", call_id="call_fx_pc-001_1", event_type="call.completed"):
    return {
        "id": event_uid,
        "type": event_type,
        "created_at": "2026-09-11T15:01:00Z",
        "data": {"id": call_id, "object": "call_task", "status": "completed"},
    }


@pytest.fixture
def client(ledger):
    app = FastAPI()
    app.include_router(build_router(WebhookReceiver(ledger)))
    return TestClient(app)


def seed_submitted(ledger, event, policy, now, transport, contact_id="pc-001",
                   phone="+14155550101"):
    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id=contact_id,
            event_id=event.event_id,
            first_name="Maria",
            phone_e164=phone,
            locale="en-US",
            tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    intent = ledger.reserve_intent(
        build_intent(
            event, contact_id, 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )
    dispatch_intent(ledger, transport, event, policy, intent, now=now)
    return intent


# -- the receiver ------------------------------------------------------------------


def test_a_delivery_inserts_one_row_and_returns_ok(client, ledger):
    response = client.post(
        WEBHOOK_PATH,
        json=webhook_payload(),
        headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"},
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "inserted"}
    assert ledger.count_inbox_rows("evt_1") == 1


def test_a_duplicate_delivery_adds_no_row(client, ledger):
    for _ in range(4):
        response = client.post(
            WEBHOOK_PATH, json=webhook_payload(), headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"}
        )
        assert response.status_code == 200
    assert ledger.count_inbox_rows("evt_1") == 1
    assert ledger.count_inbox_rows() == 1
    assert not ledger.is_quarantined("evt_1")


def test_a_conflicting_payload_under_the_same_event_id_is_quarantined(client, ledger):
    client.post(WEBHOOK_PATH, json=webhook_payload(), headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"})
    conflicting = copy.deepcopy(webhook_payload())
    conflicting["data"]["status"] = "failed"
    response = client.post(
        WEBHOOK_PATH, json=conflicting, headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "quarantined"
    assert ledger.is_quarantined("evt_1")
    assert ledger.count_inbox_rows() == 1


def test_a_header_that_disagrees_with_the_body_is_quarantined(client, ledger):
    response = client.post(
        WEBHOOK_PATH, json=webhook_payload("evt_1"), headers={WEBHOOK_EVENT_ID_HEADER: "evt_2"}
    )
    assert response.status_code == 400
    assert ledger.is_quarantined("evt_1")


def test_an_unknown_event_type_is_quarantined(client, ledger):
    response = client.post(
        WEBHOOK_PATH,
        json=webhook_payload(event_type="call.something_new"),
        headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"},
    )
    assert response.status_code == 400
    assert ledger.is_quarantined("evt_1")


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "call.completed", "data": {"id": "call_1"}},           # no event id
        {"id": "evt_1", "type": "call.completed"},                       # no data
        {"id": "evt_1", "type": "call.completed", "data": {}},           # no call id
        {"id": "", "type": "call.completed", "data": {"id": "call_1"}},  # empty event id
    ],
)
def test_a_malformed_envelope_is_rejected(client, ledger, payload):
    response = client.post(WEBHOOK_PATH, json=payload)
    assert response.status_code == 400
    assert ledger.count_inbox_rows() == 0


def test_all_three_terminal_event_types_are_accepted(client, ledger):
    for index, event_type in enumerate(
        ["call.completed", "call.failed", "call.result_validation_failed"]
    ):
        response = client.post(
            WEBHOOK_PATH,
            json=webhook_payload(f"evt_{index}", event_type=event_type),
            headers={WEBHOOK_EVENT_ID_HEADER: f"evt_{index}"},
        )
        assert response.status_code == 200, event_type
    assert ledger.count_inbox_rows() == 3


def test_the_receiver_appends_no_transition(client, ledger, event, policy, now,
                                            fixture_transport):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    before = len(ledger.list_transitions(intent.intent_id))
    client.post(WEBHOOK_PATH, json=webhook_payload(), headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"})
    assert len(ledger.list_transitions(intent.intent_id)) == before
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMITTED


# -- the worker --------------------------------------------------------------------


def test_the_worker_re_reads_and_then_adjudicates(
    ledger, event, policy, now, fixture_transport, client
):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    client.post(WEBHOOK_PATH, json=webhook_payload(), headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"})
    outcomes = process_inbox(ledger, fixture_transport, event, policy, now=now)
    assert [outcome.action for outcome in outcomes] == ["adjudicated"]
    assert ledger.reconstruct(intent.intent_id) is IntentState.CONFIRMED
    assert ledger.get_disposition(intent.intent_id) is not None


def test_a_webhook_for_a_call_we_did_not_place_is_quarantined(
    ledger, event, policy, now, fixture_transport, client
):
    client.post(
        WEBHOOK_PATH,
        json=webhook_payload(call_id="call_someone_elses"),
        headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"},
    )
    outcomes = process_inbox(ledger, fixture_transport, event, policy, now=now)
    assert [outcome.action for outcome in outcomes] == ["quarantined"]
    assert ledger.is_quarantined("evt_1")


def test_a_processed_row_is_not_processed_twice(
    ledger, event, policy, now, fixture_transport, client
):
    seed_submitted(ledger, event, policy, now, fixture_transport)
    client.post(WEBHOOK_PATH, json=webhook_payload(), headers={WEBHOOK_EVENT_ID_HEADER: "evt_1"})
    process_inbox(ledger, fixture_transport, event, policy, now=now)
    assert process_inbox(ledger, fixture_transport, event, policy, now=now) == []


# -- binding checks ----------------------------------------------------------------


def test_a_binding_mismatch_routes_to_needs_human(
    ledger, event, policy, now, fixture_transport
):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    attempt = ledger.get_attempt(intent.intent_id)
    # The re-read comes back carrying somebody else's contact id.
    payload = fixture_transport._by_call_id[attempt.call_id]
    payload["metadata"]["pc_contact_id"] = "pc-999"

    outcome = handle_terminal_call(ledger, fixture_transport, event, policy, intent, now=now)
    assert outcome.action == "binding_mismatch"
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN
    # No disposition is written from a payload we could not bind.
    assert ledger.get_disposition(intent.intent_id) is None


def test_a_missing_binding_field_routes_to_needs_human(
    ledger, event, policy, now, fixture_transport
):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    attempt = ledger.get_attempt(intent.intent_id)
    fixture_transport._by_call_id[attempt.call_id]["metadata"] = {}
    outcome = handle_terminal_call(ledger, fixture_transport, event, policy, intent, now=now)
    assert outcome.action == "binding_mismatch"
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN


def test_a_schema_version_change_is_a_binding_mismatch(ledger, event, policy, now,
                                                       fixture_transport):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    attempt = ledger.get_attempt(intent.intent_id)
    fixture_transport._by_call_id[attempt.call_id]["metadata"]["pc_schema_version"] = "old-v0"
    outcome = handle_terminal_call(ledger, fixture_transport, event, policy, intent, now=now)
    assert outcome.action == "binding_mismatch"


def test_verify_binding_accepts_a_matching_re_read(event, now, ledger):
    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id="pc-001", event_id=event.event_id, first_name="Maria",
            phone_e164="+14155550101", locale="en-US", tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    intent = ledger.reserve_intent(
        build_intent(
            event, "pc-001", 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )
    from positive_contact.dispatch import build_metadata

    assert verify_binding(intent, "call_x", build_metadata(intent)) is None


def test_the_terminal_snapshot_is_stored_redacted(
    ledger, event, policy, now, fixture_transport
):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    handle_terminal_call(ledger, fixture_transport, event, policy, intent, now=now)
    attempt = ledger.get_attempt(intent.intent_id)
    assert attempt.raw_snapshot_redacted is not None
    stored = str(attempt.raw_snapshot_redacted)
    assert "+14155550101" not in stored
    assert "+1415•••0101" in stored


def test_a_call_that_is_still_running_is_left_alone(ledger, event, policy, now,
                                                    fixture_transport):
    intent = seed_submitted(ledger, event, policy, now, fixture_transport)
    attempt = ledger.get_attempt(intent.intent_id)
    fixture_transport._by_call_id[attempt.call_id]["status"] = "in_progress"
    outcome = handle_terminal_call(ledger, fixture_transport, event, policy, intent, now=now)
    assert outcome.action == "still_running"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMITTED
