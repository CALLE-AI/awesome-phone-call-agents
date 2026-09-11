from datetime import datetime

from app.models.orm import FollowUp
from sqlalchemy.orm import Session


class FollowUpRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, followup_id: int) -> FollowUp | None:
        return self.db.query(FollowUp).filter(FollowUp.id == followup_id).first()

    def get_for_patient(self, followup_id: int, patient_id: int) -> FollowUp | None:
        return (
            self.db.query(FollowUp)
            .filter(
                FollowUp.id == followup_id,
                FollowUp.patient_id == patient_id,
            )
            .first()
        )

    def list_all(self) -> list[FollowUp]:
        return (
            self.db.query(FollowUp)
            .order_by(FollowUp.scheduled_time.desc())
            .all()
        )

    def get_due(self, now: datetime, limit: int = 20) -> list[FollowUp]:
        return (
            self.db.query(FollowUp)
            .filter(
                FollowUp.status == "pending",
                FollowUp.scheduled_time <= now,
                FollowUp.attempt_count < FollowUp.max_attempts,
            )
            .order_by(FollowUp.scheduled_time.asc())
            .limit(limit)
            .all()
        )

    def create(self, followup: FollowUp) -> FollowUp:
        self.db.add(followup)
        self.db.commit()
        self.db.refresh(followup)
        return followup

    def save(self, followup: FollowUp) -> FollowUp:
        self.db.commit()
        self.db.refresh(followup)
        return followup
