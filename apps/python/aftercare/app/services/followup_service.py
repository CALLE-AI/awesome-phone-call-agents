from app.core.datetimes import to_naive_utc
from app.models.orm import FollowUp
from app.models.schemas import FollowUpCreate
from app.repositories.followup_repository import FollowUpRepository
from app.repositories.patient_repository import PatientRepository


class FollowUpServiceError(Exception):
    """Domain/service error for follow-up operations."""


class FollowUpService:
    def __init__(
        self,
        followups: FollowUpRepository,
        patients: PatientRepository,
    ):
        self.followups = followups
        self.patients = patients

    def create(self, payload: FollowUpCreate) -> FollowUp:
        patient = self.patients.get_by_id(payload.patient_id)
        if not patient:
            raise FollowUpServiceError("patient not found")

        followup = FollowUp(
            patient_id=payload.patient_id,
            scheduled_time=to_naive_utc(payload.scheduled_time),
            max_attempts=payload.max_attempts,
            status="pending",
            attempt_count=0,
        )
        return self.followups.create(followup)

    def list(self) -> list[FollowUp]:
        return self.followups.list_all()
