"""
CALL-E Python SDK Client Adapter
"""
from __future__ import annotations
from typing import Dict, Any, Optional
from datetime import datetime, timezone
import json

from ..config import config, ClinicConfig
from ..domain.schemas import (
    CONFIRMATION_SCHEMA,
    NO_SHOW_SCHEMA,
    RECALL_SCHEMA,
    SURVEY_SCHEMA,
    PRIOR_AUTH_SCHEMA,
)
from ..domain.policy import RecipientSecurityPolicy
from ..phone import mask_phone, validate_and_format_e164
from ..adapters.audit_ledger import audit_ledger


class CalleAdapter:
    """
    Robust adapter for CALL-E Autonomous Voice Operations.
    """

    def __init__(self, clinic_cfg: Optional[ClinicConfig] = None):
        self.cfg = clinic_cfg or config
        self.policy = RecipientSecurityPolicy(
            authorized_recipients=self.cfg.authorized_recipients,
            dry_run=self.cfg.dry_run,
        )

    def dispatch_confirmation_call(
        self,
        phone: str,
        patient_name: str = "Jane Doe",
        appointment_time: str = "Tomorrow at 10:30 AM",
        doctor_name: Optional[str] = None,
        clinic_name: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        valid_phone = self.policy.verify_call_permission(phone)
        doc = doctor_name or self.cfg.primary_doctor
        cln = clinic_name or self.cfg.clinic_name

        task = (
            f"Call {valid_phone} to confirm an appointment with {doc} at {cln} "
            f"scheduled for {appointment_time}. Ask if they can attend. If yes, confirm the time. "
            f"If they need to reschedule or cancel, capture their preferred time or reason politely."
        )

        audit_ledger.record(
            actor="receptionist_agent",
            action="calle.dispatch_confirmation",
            resource_type="call",
            resource_id=idempotency_key or "single_call",
            details={"recipient": mask_phone(valid_phone), "dry_run": self.cfg.dry_run},
        )

        if self.cfg.dry_run:
            return {
                "status": "completed",
                "task_completed": True,
                "recipient_masked": mask_phone(valid_phone),
                "completion_confidence": {"score": 0.96, "label": "high"},
                "evidence": [f"Patient confirmed attendance for {appointment_time}."],
                "structured_result": {
                    "will_attend": "yes",
                    "preferred_reschedule_time": None,
                    "cancellation_reason": None,
                    "special_instructions_acknowledged": True,
                },
                "dry_run": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        from calle import CalleClient  # type: ignore
        client = CalleClient(api_key=self.cfg.calle_api_key)
        return client.calls.create_and_wait(
            task=task,
            recipients=[{"phones": [valid_phone], "region": "US", "locale": "en-US"}],
            result_schema=CONFIRMATION_SCHEMA,
            idempotency_key=idempotency_key,
            timeout_seconds=300,
        )

    def dispatch_noshow_recovery_call(
        self,
        phone: str,
        patient_name: str = "Jane Doe",
        missed_time: str = "Today at 9:00 AM",
    ) -> Dict[str, Any]:
        valid_phone = self.policy.verify_call_permission(phone)
        cln = self.cfg.clinic_name

        task = (
            f"Call {valid_phone} regarding their missed appointment at {cln} on {missed_time}. "
            f"Politely check in on their wellbeing and offer to reschedule their appointment for later this week."
        )

        audit_ledger.record(
            actor="receptionist_agent",
            action="calle.dispatch_noshow_recovery",
            resource_type="call",
            resource_id="noshow_call",
            details={"recipient": mask_phone(valid_phone), "dry_run": self.cfg.dry_run},
        )

        if self.cfg.dry_run:
            return {
                "status": "completed",
                "task_completed": True,
                "recipient_masked": mask_phone(valid_phone),
                "completion_confidence": {"score": 0.91, "label": "high"},
                "evidence": ["Patient requested rebooking for next Tuesday afternoon."],
                "structured_result": {
                    "wants_rebook": "yes",
                    "preferred_time": "Next Tuesday at 2:00 PM",
                    "reason_for_no_show": "Transportation delay",
                },
                "dry_run": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        from calle import CalleClient  # type: ignore
        client = CalleClient(api_key=self.cfg.calle_api_key)
        return client.calls.create_and_wait(
            task=task,
            recipients=[{"phones": [valid_phone], "region": "US", "locale": "en-US"}],
            result_schema=NO_SHOW_SCHEMA,
            timeout_seconds=300,
        )

    def dispatch_prior_auth_call(
        self,
        payor_phone: str,
        payor_name: str,
        cpt_code: str,
        member_id_masked: str,
        ivr_hints: str = "Press 1 for Provider Services, then press 2 for Prior Authorizations.",
    ) -> Dict[str, Any]:
        task = (
            f"Call {payor_name} Prior Authorization line at {payor_phone}. "
            f"IVR Navigation: {ivr_hints}. "
            f"Check status for CPT {cpt_code}, Member ID {member_id_masked}. "
            f"Request decision, auth number, reference number, and representative name."
        )

        audit_ledger.record(
            actor="prior_auth_agent",
            action="calle.dispatch_prior_auth",
            resource_type="prior_auth",
            resource_id=cpt_code,
            details={"payor": payor_name, "dry_run": self.cfg.dry_run},
        )

        if self.cfg.dry_run:
            return {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.98, "label": "high"},
                "evidence": [f"Representative confirmed CPT {cpt_code} approved under auth #AUTH-882194."],
                "structured_result": {
                    "auth_status": "approved",
                    "authorization_number": "AUTH-882194",
                    "representative_name": "Sarah M. (Ext 401)",
                    "reference_number": "REF-99201-BCBS",
                    "denial_reason": None,
                },
                "dry_run": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        from calle import CalleClient  # type: ignore
        client = CalleClient(api_key=self.cfg.calle_api_key)
        return client.calls.create_and_wait(
            task=task,
            recipients=[{"phones": [payor_phone], "region": "US", "locale": "en-US"}],
            result_schema=PRIOR_AUTH_SCHEMA,
            timeout_seconds=300,
        )


    def dispatch_recall_call(
        self,
        phone: str,
        patient_name: str = "Jane Doe",
        recall_interval: str = "30-day",
        care_type: str = "routine preventive care",
    ) -> Dict[str, Any]:
        valid_phone = self.policy.verify_call_permission(phone)
        cln = self.cfg.clinic_name

        task = (
            f"Call {valid_phone} for a {recall_interval} patient recall from {cln}. "
            f"Inform them they are due for {care_type}. Ask if they are interested in scheduling "
            f"a visit, and capture their preferred day and time window."
        )

        audit_ledger.record(
            actor="recall_agent",
            action="calle.dispatch_recall",
            resource_type="call",
            resource_id="recall_call",
            details={"recipient": mask_phone(valid_phone), "dry_run": self.cfg.dry_run},
        )

        if self.cfg.dry_run:
            return {
                "status": "completed",
                "task_completed": True,
                "recipient_masked": mask_phone(valid_phone),
                "completion_confidence": {"score": 0.89, "label": "high"},
                "evidence": [f"Patient interested in scheduling {recall_interval} preventive visit."],
                "structured_result": {
                    "interested": "yes",
                    "preferred_day": "Wednesday",
                    "preferred_time": "Morning, before 11:00 AM",
                    "notes": "Patient mentioned mild knee stiffness.",
                },
                "dry_run": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        from calle import CalleClient  # type: ignore
        client = CalleClient(api_key=self.cfg.calle_api_key)
        return client.calls.create_and_wait(
            task=task,
            recipients=[{"phones": [valid_phone], "region": "US", "locale": "en-US"}],
            result_schema=RECALL_SCHEMA,
            timeout_seconds=300,
        )

    def dispatch_survey_call(
        self,
        phone: str,
        patient_name: str = "Jane Doe",
        visit_date: str = "Yesterday",
    ) -> Dict[str, Any]:
        valid_phone = self.policy.verify_call_permission(phone)
        cln = self.cfg.clinic_name

        task = (
            f"Call {valid_phone} for a post-visit satisfaction survey from {cln}. "
            f"Their visit was on {visit_date}. Ask them to rate their experience on a scale of 1-10, "
            f"whether they would recommend the clinic, and capture any specific feedback."
        )

        audit_ledger.record(
            actor="survey_agent",
            action="calle.dispatch_survey",
            resource_type="call",
            resource_id="survey_call",
            details={"recipient": mask_phone(valid_phone), "dry_run": self.cfg.dry_run},
        )

        if self.cfg.dry_run:
            return {
                "status": "completed",
                "task_completed": True,
                "recipient_masked": mask_phone(valid_phone),
                "completion_confidence": {"score": 0.94, "label": "high"},
                "evidence": ["Patient gave NPS score of 9 and praised the staff's professionalism."],
                "structured_result": {
                    "nps_score": 9,
                    "would_recommend": "yes",
                    "main_feedback": "Staff was very professional and the wait time was minimal.",
                },
                "dry_run": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        from calle import CalleClient  # type: ignore
        client = CalleClient(api_key=self.cfg.calle_api_key)
        return client.calls.create_and_wait(
            task=task,
            recipients=[{"phones": [valid_phone], "region": "US", "locale": "en-US"}],
            result_schema=SURVEY_SCHEMA,
            timeout_seconds=300,
        )


calle_adapter = CalleAdapter()
