"""Unit tests for CareRing Health data models and audit hashing."""

import pytest
from src.models import (
    ClinicalAuditRecord,
    DischargedPatientCase,
    MedicationAdherence,
    PatientDetails,
    PrescribedMedication,
    TriageStatus,
)


def test_patient_case_creation():
    case = DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-TEST-1",
            name="Aarav Sharma",
            phone="+919876543210",
            age=52,
            procedure_name="Angioplasty",
            primary_doctor="Dr. Joshi",
            clinic_name="Heart Institute"
        ),
        medications=[PrescribedMedication(drug_name="Aspirin", dosage="100mg")]
    )
    assert case.patient.patient_id == "PAT-TEST-1"
    assert len(case.medications) == 1
    assert case.medications[0].drug_name == "Aspirin"


def test_clinical_audit_hash():
    record = ClinicalAuditRecord(
        patient_id="PAT-TEST-1",
        previous_triage="REGISTERED",
        new_triage=TriageStatus.CRITICAL_EMERGENCY_ESCALATION.value,
        escalated=True,
        summary="Chest pain 5/5"
    )
    h1 = record.calculate_hash("0" * 64)
    assert len(h1) == 64
    assert isinstance(h1, str)
    
    # Deterministic check
    h2 = record.calculate_hash("0" * 64)
    assert h1 == h2
