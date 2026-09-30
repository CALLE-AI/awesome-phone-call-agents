from __future__ import annotations

from datetime import datetime, timezone

from app.models.orm import WebhookEvent
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


class WebhookEventRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_event_id(self, event_id: str) -> WebhookEvent | None:
        return (
            self.db.query(WebhookEvent)
            .filter(WebhookEvent.event_id == event_id)
            .first()
        )

    def try_claim(
        self,
        *,
        event_id: str,
        event_type: str,
        call_id: int | None = None,
    ) -> WebhookEvent | None:
        """Claim an event for processing.

        Returns the row when this worker should process it.
        Returns None when the event was already processed successfully
        (or is currently claimed by a concurrent insert race).
        Failed / unfinished rows are reclaimed so CALL-E retries can run.
        """
        existing = self.get_by_event_id(event_id)
        if existing is not None:
            if existing.status == "processed":
                return None

            existing.status = "pending"
            existing.event_type = event_type
            if call_id is not None:
                existing.call_id = call_id
            existing.error = None
            existing.processed_at = None
            existing.received_at = datetime.now(timezone.utc).replace(tzinfo=None)
            self.db.commit()
            self.db.refresh(existing)
            return existing

        row = WebhookEvent(
            event_id=event_id,
            event_type=event_type,
            call_id=call_id,
            status="pending",
            received_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        try:
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
            return row
        except IntegrityError:
            self.db.rollback()
            raced = self.get_by_event_id(event_id)
            if raced is None or raced.status == "processed":
                return None
            # Another worker inserted first and is still pending — skip.
            if raced.status == "pending":
                return None
            # Concurrent failed row: reclaim.
            raced.status = "pending"
            raced.event_type = event_type
            if call_id is not None:
                raced.call_id = call_id
            raced.error = None
            raced.processed_at = None
            self.db.commit()
            self.db.refresh(raced)
            return raced

    def mark_processed(self, event: WebhookEvent, *, call_id: int | None = None) -> WebhookEvent:
        if call_id is not None:
            event.call_id = call_id
        event.status = "processed"
        event.error = None
        event.processed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        self.db.commit()
        self.db.refresh(event)
        return event

    def mark_failed(
        self,
        event: WebhookEvent,
        *,
        error: str,
        call_id: int | None = None,
    ) -> WebhookEvent:
        if call_id is not None:
            event.call_id = call_id
        event.status = "failed"
        event.error = error[:4000]
        event.processed_at = datetime.now(timezone.utc).replace(tzinfo=None)
        self.db.commit()
        self.db.refresh(event)
        return event
