from app.core.datetimes import to_naive_utc
from app.models.orm import FollowUp, Patient
from app.models.schemas import PatientCreate
from app.repositories.followup_repository import FollowUpRepository
from app.repositories.patient_repository import PatientRepository
from app.repositories.protocol_repository import ProtocolRepository
from app.utils.validators import is_valid_e164


class PatientServiceError(Exception):
    """Domain/service error for patient operations."""


class PatientService:
    def __init__(
        self,
        patients: PatientRepository,
        protocols: ProtocolRepository,
        followups: FollowUpRepository,
    ):
        self.patients = patients
        self.protocols = protocols
        self.followups = followups

    def create(self, payload: PatientCreate) -> Patient:
        if not is_valid_e164(payload.phone):
            raise PatientServiceError(
                "phone must be a valid E.164 number, eg: +15555550100"
            )
        protocol = self.protocols.get_active_by_id(payload.protocol_id)
        if not protocol:
            raise PatientServiceError("Protocol not found")

        patient = Patient(
            name=payload.name,
            phone=payload.phone,
            age=payload.age,
            gender=payload.gender,
            doctor_name=payload.doctor_name,
            doctor_contact=payload.doctor_contact,
            discharge_date=payload.discharge_date,
            discharge_diagnosis=payload.discharge_diagnosis,
            consent_on_file=payload.consent_on_file,
            current_risk_level="low",
            protocol_id=payload.protocol_id,
            needs_followup=payload.needs_followup,
        )
        patient = self.patients.create(patient)

        if patient.needs_followup:
            scheduled = to_naive_utc(payload.followup_scheduled_time)
            self.followups.create(
                FollowUp(
                    patient_id=patient.id,
                    scheduled_time=scheduled,
                    status="pending",
                    attempt_count=0,
                    max_attempts=3,
                )
            )

        return patient

    def list(self) -> list[Patient]:
        return self.patients.list_all()

    def get(self, patient_id: int) -> Patient:
        patient = self.patients.get_by_id(patient_id)
        if not patient:
            raise PatientServiceError("Patient not found")
        return patient
