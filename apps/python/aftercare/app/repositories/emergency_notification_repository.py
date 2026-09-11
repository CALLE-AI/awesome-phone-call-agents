from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.orm import EmergencyNotification


class EmergencyNotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_call_and_channel(
        self, call_id: int, channel: str
    ) -> EmergencyNotification | None:
        return (
            self.db.query(EmergencyNotification)
            .filter(
                EmergencyNotification.call_id == call_id,
                EmergencyNotification.channel == channel,
            )
            .first()
        )

    def get_by_provider_id(self, provider_id: str) -> EmergencyNotification | None:
        return (
            self.db.query(EmergencyNotification)
            .filter(EmergencyNotification.provider_id == str(provider_id))
            .first()
        )

    def get_or_create(
        self,
        *,
        call_id: int,
        patient_id: int,
        channel: str,
        to_number: str | None,
        message_body: str | None,
    ) -> EmergencyNotification:
        existing = self.get_by_call_and_channel(call_id, channel)
        if existing:
            return existing

        row = EmergencyNotification(
            call_id=call_id,
            patient_id=patient_id,
            channel=channel,
            to_number=to_number,
            status="pending",
            message_body=message_body,
            attempt_count=0,
        )
        try:
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
            return row
        except IntegrityError:
            self.db.rollback()
            existing = self.get_by_call_and_channel(call_id, channel)
            if existing:
                return existing
            raise

    def save(self, row: EmergencyNotification) -> EmergencyNotification:
        self.db.commit()
        self.db.refresh(row)
        return row
