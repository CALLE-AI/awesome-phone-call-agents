from __future__ import annotations

from unittest.mock import MagicMock

from app.models.orm import Call
from app.services.webhook_service import WebhookService


def test_duplicate_webhook_event_id_is_acknowledged() -> None:
    call = Call(id=7, patient_id=1, status="queued", calle_call_id="calle_call_1")
    calls = MagicMock()
    calls.get_by_provider_id.return_value = call
    events = MagicMock()
    events.try_claim.return_value = None
    notifications = MagicMock()
    notifications.is_warning_call.return_value = False

    service = WebhookService(
        calls=calls,
        patients=MagicMock(),
        symptoms=MagicMock(),
        protocols=MagicMock(),
        webhook_events=events,
        notifications=notifications,
    )

    result = service.process_calle_event(
        event_id="evt-duplicate-1",
        event_type="call.completed",
        provider_call_id="calle_call_1",
    )

    assert result == {
        "ok": True,
        "duplicate": True,
        "event_id": "evt-duplicate-1",
    }
    calls.get_by_provider_id.assert_called_once_with("calle_call_1")
    calls.get_by_id.assert_not_called()
    events.try_claim.assert_called_once()
