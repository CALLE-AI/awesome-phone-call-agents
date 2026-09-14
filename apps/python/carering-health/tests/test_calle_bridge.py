"""Unit tests for CALL-E clinical telephony bridge in CareRing Health."""

import pytest
from src.calle_bridge import CalleBridge
from src.models import (
    DischargedPatientCase,
    MedicationAdherence,
    PatientDetails,
    PrescribedMedication,
    TriageStatus,
)


@pytest.fixture
def sample_patient_case():
    return DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-CARE-01",
            name="Suresh Raina",
            phone="+919876543210",
            age=45,
            procedure_name="Cardiac Stenting",
            primary_doctor="Dr. Aditi Joshi",
            clinic_name="Apollo Cardiology"
        ),
        medications=[PrescribedMedication(drug_name="Atorvastatin", dosage="40mg")]
    )


def test_build_clinical_prompt(sample_patient_case):
    bridge = CalleBridge()
    prompt = bridge.build_clinical_prompt(sample_patient_case)
    assert "Apollo Cardiology" in prompt
    assert "Suresh Raina" in prompt
    assert "Cardiac Stenting" in prompt
    assert "Press '1'" in prompt


def test_result_schema_structure():
    bridge = CalleBridge()
    schema = bridge.get_result_schema()
    assert schema["type"] == "object"
    assert "medication_status" in schema["properties"]
    assert "pain_score" in schema["properties"]
    assert "escalate_to_nurse" in schema["properties"]


def test_mock_dispatch_scenarios(sample_patient_case):
    bridge = CalleBridge()

    # Normal recovery
    res_normal = bridge._mock_dispatch(sample_patient_case, scenario="normal")
    assert res_normal.triage_level == TriageStatus.NORMAL
    assert res_normal.escalate_to_nurse is False
    assert res_normal.pain_score == 1
    assert res_normal.medication_status == MedicationAdherence.TAKEN

    # Critical flare
    res_critical = bridge._mock_dispatch(sample_patient_case, scenario="critical")
    assert res_critical.triage_level == TriageStatus.CRITICAL_EMERGENCY_ESCALATION
    assert res_critical.escalate_to_nurse is True
    assert res_critical.pain_score == 5
    assert res_critical.medication_status == MedicationAdherence.MISSED
