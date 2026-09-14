"""Unit tests for CareRing clinical triage engine and emergency escalations."""

import pytest
from src.calle_bridge import CalleBridge
from src.models import (
    DischargedPatientCase,
    MedicationAdherence,
    PatientDetails,
    PrescribedMedication,
    TriageStatus,
)
from src.triage_engine import CareRingTriageEngine


@pytest.fixture
def test_engine():
    return CareRingTriageEngine(bridge=CalleBridge())


@pytest.fixture
def test_patient():
    return DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-TRIAGE-01",
            name="Kavita Krishnan",
            phone="+919876543210",
            age=55,
            procedure_name="Gallbladder Removal",
            primary_doctor="Dr. Priya Bansal",
            clinic_name="Fortis Healthcare"
        ),
        medications=[PrescribedMedication(drug_name="Cefixime", dosage="200mg")]
    )


@pytest.mark.asyncio
async def test_normal_triage_flow(test_engine, test_patient):
    pid = test_engine.register_patient_case(test_patient)
    assert pid == "PAT-TRIAGE-01"
    assert test_engine.triage_states[pid] == TriageStatus.NORMAL

    result = await test_engine.run_followup_call(pid, scenario="normal")
    assert result.triage_level == TriageStatus.NORMAL
    assert result.escalate_to_nurse is False
    assert len(test_engine.nurse_alerts) == 0

    metrics = test_engine.get_metrics()
    assert metrics["adherent_patients"] == 1
    assert metrics["emergency_escalations_caught"] == 0


@pytest.mark.asyncio
async def test_critical_emergency_escalation(test_engine):
    critical_patient = DischargedPatientCase(
        patient=PatientDetails(
            patient_id="PAT-CRIT-99",
            name="Harish Patel",
            phone="+919999911111",
            age=70,
            procedure_name="Triple Vessel CABG",
            primary_doctor="Dr. Aditi Joshi",
            clinic_name="Apollo Heart Institute"
        ),
        medications=[PrescribedMedication(drug_name="Brilinta", dosage="90mg")]
    )
    test_engine.register_patient_case(critical_patient)
    result = await test_engine.run_followup_call("PAT-CRIT-99", scenario="critical")
    
    assert result.triage_level == TriageStatus.CRITICAL_EMERGENCY_ESCALATION
    assert result.escalate_to_nurse is True
    assert len(test_engine.nurse_alerts) == 1
    alert = test_engine.nurse_alerts[0]
    assert alert["patient_id"] == "PAT-CRIT-99"
    assert alert["urgency"] == "CRITICAL_RED"

    metrics = test_engine.get_metrics()
    assert metrics["emergency_escalations_caught"] == 1
    assert len(test_engine.audit_log) >= 2
