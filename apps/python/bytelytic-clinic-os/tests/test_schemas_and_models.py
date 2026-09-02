import pytest
from bytelytic_clinic.domain.schemas import (
    CONFIRMATION_SCHEMA,
    NO_SHOW_SCHEMA,
    RECALL_SCHEMA,
    SURVEY_SCHEMA,
    PRIOR_AUTH_SCHEMA,
)
from bytelytic_clinic.domain.models import (
    AppointmentRecord,
    PatientRecord,
    PriorAuthRecord,
    AppointmentStatus,
    CampaignType,
)


def test_confirmation_schema_structure():
    assert "will_attend" in CONFIRMATION_SCHEMA["properties"]
    assert "preferred_reschedule_time" in CONFIRMATION_SCHEMA["properties"]
    assert "will_attend" in CONFIRMATION_SCHEMA["required"]


def test_noshow_schema_structure():
    assert "wants_rebook" in NO_SHOW_SCHEMA["properties"]
    assert "reason_for_no_show" in NO_SHOW_SCHEMA["properties"]
    assert "wants_rebook" in NO_SHOW_SCHEMA["required"]


def test_recall_schema_structure():
    assert "interested" in RECALL_SCHEMA["properties"]
    assert "preferred_day" in RECALL_SCHEMA["properties"]


def test_survey_schema_structure():
    assert "nps_score" in SURVEY_SCHEMA["properties"]
    assert SURVEY_SCHEMA["properties"]["nps_score"]["maximum"] == 10


def test_prior_auth_schema_structure():
    assert "auth_status" in PRIOR_AUTH_SCHEMA["properties"]
    assert "authorization_number" in PRIOR_AUTH_SCHEMA["properties"]


def test_patient_model_defaults():
    p = PatientRecord()
    assert p.name == "Jane Doe"
    assert p.phone == "+15550192834"
    assert "**" in p.dob_masked


def test_appointment_model_initial_state():
    apt = AppointmentRecord()
    assert apt.status == AppointmentStatus.SCHEDULED
    assert apt.clinic_name == "Oakridge Wellness Clinic"


def test_appointment_status_enum_values():
    assert AppointmentStatus.CONFIRMED.value == "confirmed"
    assert AppointmentStatus.CANCELLED.value == "cancelled"
    assert AppointmentStatus.NO_SHOW.value == "no_show"


def test_campaign_type_enum():
    assert CampaignType.CONFIRMATION.value == "confirmation"
    assert CampaignType.PRIOR_AUTH.value == "prior_auth"


def test_prior_auth_model_creation():
    pa = PriorAuthRecord(cpt_code="99214", payor_name="Aetna")
    assert pa.cpt_code == "99214"
    assert pa.auth_status == "pending"
