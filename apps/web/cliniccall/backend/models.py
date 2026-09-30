from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


# ============================================================
# PATIENT
# ============================================================

class Patient(SQLModel, table=True):
    id: Optional[int] = Field(
        default=None,
        primary_key=True
    )

    name: str
    phone_number: str


# ============================================================
# APPOINTMENT
# ============================================================

class Appointment(SQLModel, table=True):
    id: Optional[int] = Field(
        default=None,
        primary_key=True
    )

    patient_id: int
    appointment_date: str
    appointment_time: str
    clinic_name: str = "ClinicCall Demo Clinic"
    status: str = "pending"


# ============================================================
# CALL HISTORY
# ============================================================

class CallHistory(SQLModel, table=True):
    id: Optional[int] = Field(
        default=None,
        primary_key=True
    )

    appointment_id: int
    phone_number: str
    call_status: str
    appointment_status: str

    created_at: datetime = Field(
        default_factory=datetime.utcnow
    )


# ============================================================
# API INPUT MODELS
# ============================================================

class PatientCreate(SQLModel):
    name: str
    phone_number: str


class AppointmentCreate(SQLModel):
    patient_id: int
    appointment_date: str
    appointment_time: str
    clinic_name: str = "ClinicCall Demo Clinic"