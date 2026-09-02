"""
Simulated Clinical EHR Adapter & Operator Staging Store
"""
from __future__ import annotations
from typing import Dict, Optional, List
from ..domain.models import AppointmentRecord, PatientRecord, AppointmentStatus
from ..adapters.audit_ledger import audit_ledger


class SimulatedEHRAdapter:
    """
    Simulates an EHR repository (e.g. Epic, Cerner, AthenaHealth)
    with strict operator verification staging before consequential record writes.
    """

    def __init__(self):
        self.patients: Dict[str, PatientRecord] = {}
        self.appointments: Dict[str, AppointmentRecord] = {}
        self.staged_updates: List[Dict] = []
        self._seed_demo_data()

    def _seed_demo_data(self):
        p1 = PatientRecord(id="p-001", name="Jane Doe", phone="+15550192834")
        p2 = PatientRecord(id="p-002", name="Alex Demo", phone="+15550192835")
        self.patients[p1.id] = p1
        self.patients[p2.id] = p2

        a1 = AppointmentRecord(id="apt-101", patient_id=p1.id, scheduled_time="Tomorrow at 10:30 AM")
        a2 = AppointmentRecord(id="apt-102", patient_id=p2.id, scheduled_time="Today at 9:00 AM", status=AppointmentStatus.NO_SHOW)
        self.appointments[a1.id] = a1
        self.appointments[a2.id] = a2

    def get_appointment(self, appointment_id: str) -> Optional[AppointmentRecord]:
        return self.appointments.get(appointment_id)

    def stage_status_update(self, appointment_id: str, proposed_status: AppointmentStatus, evidence: str) -> Dict:
        stage_entry = {
            "appointment_id": appointment_id,
            "proposed_status": proposed_status.value,
            "evidence": evidence,
            "operator_approved": False,
        }
        self.staged_updates.append(stage_entry)
        audit_ledger.record("calle_webhook", "appointment.staged_for_review", "appointment", appointment_id, stage_entry)
        return stage_entry

    def apply_operator_approval(self, appointment_id: str, approved_status: AppointmentStatus, operator_name: str) -> AppointmentRecord:
        apt = self.appointments.get(appointment_id)
        if not apt:
            raise KeyError(f"Appointment {appointment_id} not found.")
        apt.status = approved_status
        audit_ledger.record(operator_name, "appointment.operator_approved", "appointment", appointment_id, {"status": approved_status.value})
        return apt


ehr_adapter = SimulatedEHRAdapter()
