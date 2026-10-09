"""
Domain Data Models for Clinical Operations
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from enum import Enum
import uuid


class AppointmentStatus(str, Enum):
    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    RESCHEDULE_REQUESTED = "reschedule_requested"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    COMPLETED = "completed"


class CampaignType(str, Enum):
    CONFIRMATION = "confirmation"
    NO_SHOW_RECOVERY = "no_show"
    RECALL = "recall"
    SURVEY = "survey"
    PRIOR_AUTH = "prior_auth"


@dataclass
class PatientRecord:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Jane Doe"
    phone: str = "+15550192834"
    dob_masked: str = "1985-**-**"
    insurance_carrier: str = "Blue Cross Blue Shield"
    member_id_masked: str = "MBR-***-8492"
    last_visit_date: Optional[str] = None


@dataclass
class AppointmentRecord:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    patient_id: str = ""
    patient_name: str = "Jane Doe"
    phone: str = "+15550192834"
    doctor_name: str = "Dr. Demo Specialist, MD"
    clinic_name: str = "Oakridge Wellness Clinic"
    scheduled_time: str = "Tomorrow at 10:30 AM"
    status: AppointmentStatus = AppointmentStatus.SCHEDULED
    special_instructions: Optional[str] = "Please wear loose athletic clothing."
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class PriorAuthRecord:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    patient_id: str = ""
    cpt_code: str = "99213"
    payor_name: str = "Blue Cross Blue Shield"
    payor_phone: str = "1-800-676-2583"
    auth_status: str = "pending"
    authorization_number: Optional[str] = None
    reference_number: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
