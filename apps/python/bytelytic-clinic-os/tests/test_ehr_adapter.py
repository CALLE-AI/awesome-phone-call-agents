import pytest
from bytelytic_clinic.adapters.ehr_adapter import SimulatedEHRAdapter
from bytelytic_clinic.domain.models import AppointmentStatus


def test_ehr_seeded_records():
    ehr = SimulatedEHRAdapter()
    assert len(ehr.patients) >= 2
    assert len(ehr.appointments) >= 2


def test_ehr_fetch_existing_appointment():
    ehr = SimulatedEHRAdapter()
    apt = ehr.get_appointment("apt-101")
    assert apt is not None
    assert apt.patient_name == "Jane Doe"


def test_ehr_fetch_missing_appointment():
    ehr = SimulatedEHRAdapter()
    assert ehr.get_appointment("apt-non-existent") is None


def test_ehr_stage_status_update():
    ehr = SimulatedEHRAdapter()
    entry = ehr.stage_status_update("apt-101", AppointmentStatus.CONFIRMED, "Patient said yes")
    assert entry["appointment_id"] == "apt-101"
    assert entry["proposed_status"] == "confirmed"
    assert entry["operator_approved"] is False
    assert len(ehr.staged_updates) == 1


def test_ehr_apply_operator_approval():
    ehr = SimulatedEHRAdapter()
    apt = ehr.apply_operator_approval("apt-101", AppointmentStatus.CONFIRMED, "Dr. Operator")
    assert apt.status == AppointmentStatus.CONFIRMED


def test_ehr_apply_operator_approval_missing_fails():
    ehr = SimulatedEHRAdapter()
    with pytest.raises(KeyError):
        ehr.apply_operator_approval("apt-999", AppointmentStatus.CONFIRMED, "Dr. Operator")


def test_ehr_stage_maintains_history():
    ehr = SimulatedEHRAdapter()
    ehr.stage_status_update("apt-101", AppointmentStatus.RESCHEDULE_REQUESTED, "Patient needs next week")
    ehr.stage_status_update("apt-102", AppointmentStatus.CONFIRMED, "Patient confirmed morning slot")
    assert len(ehr.staged_updates) == 2


def test_ehr_patient_data_integrity():
    ehr = SimulatedEHRAdapter()
    p = ehr.patients.get("p-001")
    assert p is not None
    assert p.insurance_carrier == "Blue Cross Blue Shield"
