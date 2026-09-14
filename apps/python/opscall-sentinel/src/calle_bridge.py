from __future__ import annotations

import abc
import asyncio
import json
import time
import uuid
from typing import Dict, Any, List, Optional

import httpx

from src.config import settings, validate_ascii_e164
from src.models import (
    CallRecord,
    CallResultSchema,
    IncidentAction,
    IncidentAlert,
)


class BaseCalleBridge(abc.ABC):
    """Abstract interface defining telephony bridge operations."""

    @abc.abstractmethod
    async def dispatch_incident_call(
        self,
        alert: IncidentAlert,
        to_phone: str,
        callee_role: str = "Primary On-Call SRE",
        expected_pin: str = "4829",
        force_action: Optional[IncidentAction] = None,
        force_outcome: Optional[str] = None,
    ) -> CallRecord:
        """Initiate outbound phone dispatch to the designated engineer."""
        pass


class MockCalleBridge(BaseCalleBridge):
    """Deterministic, zero-credit mock bridge for CI/CD and offline verification."""

    async def dispatch_incident_call(
        self,
        alert: IncidentAlert,
        to_phone: str,
        callee_role: str = "Primary On-Call SRE",
        expected_pin: str = "4829",
        force_action: Optional[IncidentAction] = None,
        force_outcome: Optional[str] = None,
    ) -> CallRecord:
        call_id = f"call_mock_{uuid.uuid4().hex[:8]}"
        t_start = time.time()
        
        # Simulate realistic telephony latency (sub-second for tests)
        await asyncio.sleep(0.05)

        # 1. Handle simulation of pending or ambiguous outcome
        if force_outcome in ("pending", "queued", "calling", "in_progress", "ambiguous"):
            transcript = [
                {
                    "speaker": "AGENT",
                    "offset_seconds": 0.5,
                    "text": f"Outbound call placed to {to_phone} ({callee_role}). Status: {force_outcome}. Awaiting network connection."
                }
            ]
            return CallRecord(
                call_id=call_id,
                to_phone=to_phone,
                status=force_outcome,
                mode="mock",
                duration_seconds=0.0,
                result=None,
                transcript=transcript,
                created_at=t_start,
            )

        # 2. Handle simulation of completed call with missing result schema (never fabricate ownership)
        if force_outcome == "missing_result":
            transcript = [
                {
                    "speaker": "AGENT",
                    "offset_seconds": 0.5,
                    "text": f"Outbound call placed to {to_phone}. Call completed with missing result payload."
                }
            ]
            return CallRecord(
                call_id=call_id,
                to_phone=to_phone,
                status="completed",
                mode="mock",
                duration_seconds=12.0,
                result=None,
                transcript=transcript,
                created_at=t_start,
            )

        # 3. Handle simulation of no-answer / timeout
        if force_outcome in ("no_answer", "timeout", "busy", "unreachable"):
            transcript = [
                {
                    "speaker": "AGENT",
                    "offset_seconds": 0.5,
                    "text": f"Outbound call placed to {to_phone} ({callee_role}). Ringing..."
                },
                {
                    "speaker": "SYSTEM",
                    "offset_seconds": 18.0,
                    "text": f"PSTN Carrier: Callee did not answer after 18 seconds ({force_outcome})."
                }
            ]
            result = CallResultSchema(
                incident_id=alert.id,
                callee_name=callee_role,
                callee_verified=False,
                pin_matched=False,
                verdict=IncidentAction.UNKNOWN,
                spoken_eta_minutes=0,
                dtmf_key_pressed=None,
                call_duration_seconds=18.0,
                transcript_summary=f"Primary on-call {callee_role} at {to_phone} was unreachable ({force_outcome}).",
                outcome="unreachable",
                reason=force_outcome,
                call_completed=False,
                completion_confidence=0.0,
                notes=f"Simulated carrier {force_outcome}."
            )
            return CallRecord(
                call_id=call_id,
                to_phone=to_phone,
                status="no_answer" if force_outcome == "no_answer" else force_outcome,
                mode="mock",
                duration_seconds=18.0,
                result=result,
                transcript=transcript,
                created_at=t_start,
            )

        chosen_action = force_action or IncidentAction.ACKNOWLEDGE

        transcript = [
            {
                "speaker": "AGENT",
                "offset_seconds": 0.5,
                "text": (
                    f"Urgent alert from OpsCall Sentinel. Service '{alert.service}' has entered "
                    f"{alert.severity.value} state. Description: {alert.description}. Cluster: {alert.cluster}. "
                    f"Please state or key in your four-digit authorization PIN."
                )
            },
            {
                "speaker": "CALLEE",
                "offset_seconds": 6.2,
                "text": f"My authorization PIN is {expected_pin}."
            },
            {
                "speaker": "AGENT",
                "offset_seconds": 8.0,
                "text": (
                    "PIN verified. Press 1 or say 'Acknowledge' to accept this incident. "
                    "Press 2 to escalate to secondary SRE. Press 3 to initiate automated failover."
                )
            }
        ]

        if chosen_action == IncidentAction.ACKNOWLEDGE:
            transcript.extend([
                {
                    "speaker": "CALLEE",
                    "offset_seconds": 12.4,
                    "text": "DTMF tone received: 1. Acknowledged, taking ownership now. Estimated resolution ETA is 10 minutes."
                },
                {
                    "speaker": "AGENT",
                    "offset_seconds": 15.1,
                    "text": "Confirmed. Incident state updated to ACKNOWLEDGED in live monitoring dashboard. Disconnecting."
                }
            ])
            dtmf = "1"
            eta = 10
            outcome_val = "ownership_established"
            reason_val = "Human verified with PIN and accepted ownership with 10m ETA."
        elif chosen_action == IncidentAction.ESCALATE:
            transcript.extend([
                {
                    "speaker": "CALLEE",
                    "offset_seconds": 11.8,
                    "text": "DTMF tone received: 2. Escalate to secondary SRE. I am currently unavailable."
                },
                {
                    "speaker": "AGENT",
                    "offset_seconds": 14.5,
                    "text": "Understood. Re-routing dispatch to Secondary On-Call SRE immediately."
                }
            ])
            dtmf = "2"
            eta = 0
            outcome_val = "escalated"
            reason_val = "Primary engineer requested escalation to secondary."
        else:
            transcript.extend([
                {
                    "speaker": "CALLEE",
                    "offset_seconds": 10.5,
                    "text": "DTMF tone received: 3. Trigger immediate canary rollback."
                },
                {
                    "speaker": "AGENT",
                    "offset_seconds": 13.0,
                    "text": "Automated rollback signal dispatched to Kubernetes cluster. Incident marked resolved."
                }
            ])
            dtmf = "3"
            eta = 0
            outcome_val = "rollback_triggered"
            reason_val = "Verified engineer triggered automated canary rollback."

        result = CallResultSchema(
            incident_id=alert.id,
            callee_name=callee_role,
            callee_verified=True,
            pin_matched=True,
            verdict=chosen_action,
            spoken_eta_minutes=eta,
            dtmf_key_pressed=dtmf,
            call_duration_seconds=42.5,
            transcript_summary=f"Engineer {callee_role} successfully verified PIN, pressed DTMF {dtmf} ({chosen_action.value}), stated ETA {eta}m.",
            outcome=outcome_val,
            reason=reason_val,
            call_completed=True,
            completion_confidence=1.0,
            notes="Call handled cleanly via automated triage flow."
        )

        return CallRecord(
            call_id=call_id,
            to_phone=to_phone,
            status="completed",
            mode="mock",
            duration_seconds=42.5,
            result=result,
            transcript=transcript,
            created_at=t_start,
        )


class LiveCalleBridge(BaseCalleBridge):
    """Production bridge executing outbound phone calls via CALL-E Telephony API."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or settings.calle_api_key
        raw_url = base_url or settings.calle_base_url
        if not raw_url.startswith("https://"):
            raise ValueError(f"Restricted to approved HTTPS: Base URL '{raw_url}' is not secure.")
        self.base_url = raw_url.rstrip("/").removesuffix("/v1")

    async def dispatch_incident_call(
        self,
        alert: IncidentAlert,
        to_phone: str,
        callee_role: str = "Primary On-Call SRE",
        expected_pin: str = "4829",
        force_action: Optional[IncidentAction] = None,
        force_outcome: Optional[str] = None,
    ) -> CallRecord:
        # Validate authorized live ASCII E.164 destination, excluding synthetic defaults
        validated_phone = validate_ascii_e164(to_phone, allow_synthetic=False)

        call_id = f"call_live_{uuid.uuid4().hex[:12]}"
        t_start = time.time()

        task_prompt = (
            f"Call the {callee_role} at {validated_phone} regarding an urgent {alert.severity.value} production outage. "
            f"Service: {alert.service}. Cluster: {alert.cluster}. Summary: {alert.description}. "
            f"INSTRUCTIONS:\n"
            f"1. Immediately announce the urgent alert from OpsCall Sentinel and confirm their identity as primary on-call SRE (ask for badge number 4829).\n"
            f"2. Give triage choices: Press 1 or say 'Acknowledge' (and request their estimated resolution ETA in minutes); "
            f"Press 2 or say 'Escalate' to transfer to secondary on-call; Press 3 to trigger automated failover.\n"
            f"3. Confirm their decision, thank them, and disconnect.\n"
            f"4. Fill out the result_schema strictly based on their verbal responses and DTMF key tones."
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "OpsCallSentinel/1.0"
        }

        # OpenAPI 3.1 compliant payload for CALL-E Developer API
        payload = {
            "task": task_prompt,
            "recipients": [{"phones": [validated_phone]}],
            "result_schema": CallResultSchema.model_json_schema(),
            "metadata": {
                "incident_id": alert.id,
                "service": alert.service,
                "severity": alert.severity.value,
                "cluster": alert.cluster
            }
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(f"{self.base_url}/v1/calls", json=payload, headers=headers)
                
                if resp.status_code in (200, 201):
                    data = resp.json()
                    task_id = data.get("id", call_id)
                    initial_status = data.get("status", "pending")
                    
                    # If call is pending or in progress, return without fabricated completion or PIN verification
                    if initial_status in ("pending", "queued", "calling", "in_progress"):
                        return CallRecord(
                            call_id=task_id,
                            to_phone=validated_phone,
                            status=initial_status,
                            mode="live",
                            duration_seconds=float(data.get("duration", 0.0)),
                            result=None,
                            transcript=[
                                {"speaker": "AGENT", "offset_seconds": 0.5, "text": f"Outbound dispatch placed to {validated_phone} via CALL-E gateway."},
                                {"speaker": "AGENT", "offset_seconds": 2.0, "text": f"Task queued on CALL-E network (ID: {task_id}). Status: {initial_status}."}
                            ],
                            created_at=t_start
                        )

                    structured = data.get("structured_result")
                    recipients = data.get("recipients", [])
                    if not structured and recipients and isinstance(recipients, list):
                        rcp = recipients[0]
                        if rcp.get("structured_result"):
                            structured = rcp.get("structured_result", {})
                    
                    if not structured:
                        return CallRecord(
                            call_id=task_id,
                            to_phone=validated_phone,
                            status=initial_status,
                            mode="live",
                            duration_seconds=float(data.get("duration", 0.0)),
                            result=None,
                            transcript=[{"speaker": "AGENT", "offset_seconds": 0.5, "text": "Call finished without structured verification telemetry."}],
                            created_at=t_start
                        )

                    call_result = CallResultSchema(
                        incident_id=alert.id,
                        callee_name=callee_role,
                        callee_verified=bool(structured.get("callee_verified", False)),
                        pin_matched=bool(structured.get("pin_matched", False)),
                        verdict=IncidentAction(structured.get("verdict", "UNKNOWN")),
                        spoken_eta_minutes=int(structured.get("spoken_eta_minutes", 0)),
                        dtmf_key_pressed=str(structured.get("dtmf_key_pressed", "")) if structured.get("dtmf_key_pressed") else None,
                        call_duration_seconds=float(data.get("duration", 0.0)),
                        transcript_summary=data.get("summary") or structured.get("transcript_summary", "Live call dispatched via CALL-E gateway."),
                        outcome=structured.get("outcome", "unknown"),
                        reason=structured.get("reason", "Live call completed"),
                        call_completed=(initial_status == "completed"),
                        completion_confidence=float(structured.get("completion_confidence", 0.0)),
                        notes=f"CALL-E Task ID: {task_id} | Status: {initial_status}"
                    )

                    turns = []
                    if recipients and isinstance(recipients, list):
                        for att in recipients[0].get("attempts", []):
                            turns.extend(att.get("transcript_turns", []))

                    formatted_turns = [
                        {
                            "speaker": "AGENT" if t.get("speaker") == "bot" else "CALLEE",
                            "offset_seconds": float(t.get("offset_seconds", 0.0)),
                            "text": t.get("text", "")
                        }
                        for t in turns
                    ]

                    return CallRecord(
                        call_id=task_id,
                        to_phone=validated_phone,
                        status=initial_status,
                        mode="live",
                        duration_seconds=float(data.get("duration", 35.0)),
                        result=call_result,
                        transcript=formatted_turns if formatted_turns else [
                            {"speaker": "AGENT", "offset_seconds": 0.5, "text": f"Outbound dispatch placed to {validated_phone} via CALL-E gateway."},
                            {"speaker": "AGENT", "offset_seconds": 2.0, "text": f"Task queued on CALL-E network (ID: {task_id})."}
                        ],
                        created_at=t_start
                    )
                elif resp.status_code == 429:
                    err_json = resp.json().get("error", {})
                    err_msg = err_json.get("message", "Shared line concurrency limit reached.")
                    return CallRecord(
                        call_id=call_id,
                        to_phone=validated_phone,
                        status="failed",
                        mode="live",
                        duration_seconds=0.0,
                        result=None,
                        transcript=[{"speaker": "SYSTEM", "offset_seconds": 0.1, "text": f"CALL-E API 429: {err_msg}"}],
                        created_at=t_start
                    )
                else:
                    return CallRecord(
                        call_id=call_id,
                        to_phone=validated_phone,
                        status="failed",
                        mode="live",
                        duration_seconds=0.0,
                        result=None,
                        transcript=[{"speaker": "SYSTEM", "offset_seconds": 0.1, "text": f"CALL-E HTTP {resp.status_code}: {resp.text[:200]}"}],
                        created_at=t_start
                    )

        except Exception as err:
            return CallRecord(
                call_id=call_id,
                to_phone=validated_phone,
                status="failed",
                mode="live",
                duration_seconds=0.0,
                result=None,
                transcript=[{"speaker": "SYSTEM", "offset_seconds": 0.1, "text": f"Network Exception: {str(err)[:200]}"}],
                created_at=t_start
            )


def get_calle_bridge() -> BaseCalleBridge:
    """Factory creating appropriate bridge based on environment settings."""
    if settings.calle_mode == "live" and settings.calle_api_key:
        return LiveCalleBridge(api_key=settings.calle_api_key, base_url=settings.calle_base_url)
    return MockCalleBridge()
