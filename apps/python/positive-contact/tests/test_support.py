"""The consented, operator-approved provider handoff."""

from __future__ import annotations

import json

import pytest

from positive_contact.cli import execute_run, seed_ledger
from positive_contact.models import SupportRequestState
from positive_contact.support import (
    SupportError,
    authorize_provider_call,
    poll_support_requests,
    validate_provider_result,
)


def _seed_pending(ledger, demo_preflight, fixture_transport, now):
    seed_ledger(ledger, demo_preflight)
    execute_run(
        ledger,
        fixture_transport,
        demo_preflight,
        now=now,
        simulated_clock=False,
    )
    requests = ledger.list_support_requests(demo_preflight.event.event_id)
    assert len(requests) == 1
    return requests[0]


def test_medical_question_with_permission_creates_one_support_request(
    ledger, demo_preflight, fixture_transport, now
):
    request = _seed_pending(ledger, demo_preflight, fixture_transport, now)
    assert request.contact_id == "pc-009"
    assert request.category.value == "powered_equipment"
    assert request.urgency.value == "before_outage"
    assert request.consent.value == "yes"
    assert request.state is SupportRequestState.PENDING_REVIEW

    # Reprocessing cannot create another row for the same source intent.
    execute_run(
        ledger,
        fixture_transport,
        demo_preflight,
        now=now,
        simulated_clock=False,
    )
    assert len(ledger.list_support_requests(demo_preflight.event.event_id)) == 1


def test_operator_authorizes_one_provider_call_without_resident_identity(
    ledger, demo_preflight, fixture_transport, now
):
    request = _seed_pending(ledger, demo_preflight, fixture_transport, now)
    before = len(fixture_transport.submitted_payloads)
    outcome = authorize_provider_call(
        ledger,
        fixture_transport,
        demo_preflight.event,
        request.request_id,
        provider_id="demo-equipment",
        actor="op-7",
        now=now,
    )
    assert outcome.action == "submitted"
    assert len(fixture_transport.submitted_payloads) == before + 1

    sent = fixture_transport.submitted_payloads[-1]
    serialized = json.dumps({"task": sent["task_text"], "metadata": sent["metadata"]})
    assert request.contact_id not in serialized
    assert "Walter" not in serialized
    assert "+14155550109" not in serialized
    assert "Willow" not in serialized
    assert sent["phone_e164"] == "+14155550181"


def test_provider_call_completes_to_a_redacted_structured_result(
    ledger, demo_preflight, fixture_transport, now
):
    request = _seed_pending(ledger, demo_preflight, fixture_transport, now)
    authorize_provider_call(
        ledger,
        fixture_transport,
        demo_preflight.event,
        request.request_id,
        provider_id="demo-equipment",
        actor="op-7",
        now=now,
    )
    outcomes = poll_support_requests(
        ledger, fixture_transport, demo_preflight.event, now=now
    )
    assert [item.action for item in outcomes] == ["completed"]
    stored = ledger.get_support_request(request.request_id)
    assert stored is not None
    assert stored.state is SupportRequestState.COMPLETED
    assert stored.result == {
        "availability": "yes",
        "response_window": "Within two hours",
        "public_instructions": "An operator may call the public support desk before 6 PM.",
    }


def test_double_authorization_does_not_place_a_second_call(
    ledger, demo_preflight, fixture_transport, now
):
    request = _seed_pending(ledger, demo_preflight, fixture_transport, now)
    before_authorizations = ledger.count_call_authorizations_for_event(
        demo_preflight.event.event_id
    )
    authorize_provider_call(
        ledger,
        fixture_transport,
        demo_preflight.event,
        request.request_id,
        provider_id="demo-equipment",
        actor="op-7",
        now=now,
    )
    count = len(fixture_transport.submitted_payloads)
    duplicate = authorize_provider_call(
        ledger,
        fixture_transport,
        demo_preflight.event,
        request.request_id,
        provider_id="demo-equipment",
        actor="op-7",
        now=now,
    )
    assert duplicate.action == "skipped"
    assert len(fixture_transport.submitted_payloads) == count
    assert ledger.count_call_authorizations_for_event(
        demo_preflight.event.event_id
    ) == before_authorizations + 1


def test_demo_provider_is_never_callable_in_live_mode(
    ledger, demo_preflight, fixture_transport, now
):
    request = _seed_pending(ledger, demo_preflight, fixture_transport, now)
    with pytest.raises(SupportError, match="demo-only"):
        authorize_provider_call(
            ledger,
            fixture_transport,
            demo_preflight.event,
            request.request_id,
            provider_id="demo-equipment",
            actor="op-7",
            now=now,
            live_mode=True,
        )


def test_provider_result_redacts_free_text():
    result = validate_provider_result(
        {
            "availability": "yes",
            "response_window": "Call +14155550142 today",
            "public_instructions": "Email sam@example.com about oxygen model 998877665",
        }
    )
    serialized = json.dumps(result)
    assert "+14155550142" not in serialized
    assert "sam@example.com" not in serialized
    assert "oxygen" not in serialized.lower()
    assert "998877665" not in serialized


def test_provider_result_rejects_non_string_availability():
    with pytest.raises(SupportError, match="availability must be a string"):
        validate_provider_result(
            {
                "availability": ["yes"],
                "response_window": "Today",
                "public_instructions": "Call the public desk.",
            }
        )
