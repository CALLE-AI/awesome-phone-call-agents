"""Core Clinical Triage & Patient Follow-up Engine for CareRing Health."""

import time
from typing import Any, Dict, List, Optional
from src.calle_bridge import CalleBridge
from src.models import (
    CalleClinicalResult,
    ClinicalAuditRecord,
    DischargedPatientCase,
    MedicationAdherence,
    TriageStatus,
)


class CareRingTriageEngine:
    def __init__(self, bridge: Optional[CalleBridge] = None):
        self.bridge = bridge or CalleBridge()
        self.cases: Dict[str, DischargedPatientCase] = {}
        self.triage_states: Dict[str, TriageStatus] = {}
        self.clinical_results: Dict[str, CalleClinicalResult] = {}
        self.nurse_alerts: List[Dict[str, Any]] = []
        self.audit_log: List[ClinicalAuditRecord] = []
        self.latest_audit_hash: str = "0" * 64

    def register_patient_case(self, patient_case: DischargedPatientCase) -> str:
        pid = patient_case.patient.patient_id
        self.cases[pid] = patient_case
        self.triage_states[pid] = TriageStatus.NORMAL
        
        # Initial audit entry
        record = ClinicalAuditRecord(
            patient_id=pid,
            previous_triage="REGISTERED_POST_DISCHARGE",
            new_triage=TriageStatus.NORMAL.value,
            escalated=False,
            summary=f"Patient registered post {patient_case.patient.procedure_name}"
        )
        self.latest_audit_hash = record.calculate_hash(self.latest_audit_hash)
        self.audit_log.append(record)
        return pid

    async def run_followup_call(
        self,
        patient_id: str,
        scenario: str = "normal"
    ) -> CalleClinicalResult:
        if patient_id not in self.cases:
            raise ValueError(f"Patient ID #{patient_id} not found in CareRing registry.")

        patient_case = self.cases[patient_id]
        prev_status = self.triage_states[patient_id]

        # Dispatch Call via CALL-E Bridge
        if scenario in ["critical", "moderate"]:
            result = self.bridge._mock_dispatch(patient_case, scenario=scenario)
        else:
            result = await self.bridge.dispatch_clinical_call(patient_case)

        self.clinical_results[patient_id] = result
        self.triage_states[patient_id] = result.triage_level

        # Evaluate Emergency Escalation
        if result.escalate_to_nurse or result.pain_score >= 4 or result.triage_level == TriageStatus.CRITICAL_EMERGENCY_ESCALATION:
            alert = {
                "alert_id": f"ALERT-{int(time.time())}",
                "patient_id": patient_id,
                "patient_name": patient_case.patient.name,
                "phone": patient_case.patient.phone,
                "urgency": "CRITICAL_RED",
                "pain_score": result.pain_score,
                "symptoms": result.symptoms_reported,
                "action": "IMMEDIATE_ON_CALL_NURSE_DISPATCH",
                "timestamp": time.time()
            }
            self.nurse_alerts.append(alert)

        # Append SHA-256 Chained Audit Record
        audit_record = ClinicalAuditRecord(
            patient_id=patient_id,
            previous_triage=prev_status.value,
            new_triage=result.triage_level.value,
            escalated=result.escalate_to_nurse,
            summary=f"Pain: {result.pain_score}/5 | Meds: {result.medication_status.value} | Symptoms: {result.symptoms_reported or 'None'}"
        )
        self.latest_audit_hash = audit_record.calculate_hash(self.latest_audit_hash)
        self.audit_log.append(audit_record)

        return result

    def get_metrics(self) -> Dict[str, Any]:
        total = len(self.cases)
        adherent = sum(1 for r in self.clinical_results.values() if r.medication_status == MedicationAdherence.TAKEN)
        critical = len(self.nurse_alerts)
        confirmed_appts = sum(1 for r in self.clinical_results.values() if r.appointment_confirmed)

        return {
            "total_patients_monitored": total,
            "adherent_patients": adherent,
            "adherence_rate_pct": round((adherent / total * 100) if total > 0 else 0, 1),
            "emergency_escalations_caught": critical,
            "confirmed_appointments": confirmed_appts,
            "audit_trail_depth": len(self.audit_log),
            "latest_sha256_audit_seal": self.latest_audit_hash
        }
