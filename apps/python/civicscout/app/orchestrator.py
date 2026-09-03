import datetime
import logging
from typing import Any, Dict, List, Optional
from app.database import db
from app.models import (
    CivicTicket,
    TicketStatus,
    TicketSeverity,
    DepartmentEnum,
    StructuredCallResult,
    CallAuditLog,
    EscalationDetail,
    CalleWebhookPayload,
)
from app.calle_client import calle_client

logger = logging.getLogger("CivicScout.Orchestrator")


class MultiAgentCivicOrchestrator:
    """
    Autonomous Multi-Agent Orchestrator for Civic Work Orders.
    Manages the primary triage agent, processes mid-call and post-call telemetry,
    and dynamically provisions secondary specialized agents for departmental escalation.
    """

    async def poll_and_dispatch_pending(self) -> Dict[str, Any]:
        """Find all pending tickets in Firestore and trigger CALL-E outreach."""
        pending_tickets = await db.get_pending_tickets()
        logger.info("Orchestrator: Found %d pending ticket(s) awaiting outreach.", len(pending_tickets))

        dispatched = []
        for ticket in pending_tickets:
            # Mark ticket as in-progress
            await db.update_ticket_status(
                ticket_id=ticket.id,
                status=TicketStatus.CALL_IN_PROGRESS,
                notes=f"Outbound CALL-E agent dial initiated to {ticket.reporter.phone_e164}."
            )

            # Trigger CALL-E primary agent
            call_info = await calle_client.initiate_primary_call(ticket)
            dispatched.append({
                "ticket_id": ticket.id,
                "department": ticket.department.value,
                "call_id": call_info.get("call_id"),
                "status": call_info.get("status"),
                "phone": ticket.reporter.phone_e164,
            })

        return {
            "count": len(dispatched),
            "dispatched_tickets": dispatched,
        }

    async def dispatch_single_ticket(self, ticket_id: str) -> Dict[str, Any]:
        """Manually or programmatically trigger a call for a specific ticket."""
        ticket = await db.get_ticket(ticket_id)
        if not ticket:
            return {"success": False, "error": f"Ticket '{ticket_id}' not found."}

        await db.update_ticket_status(
            ticket_id=ticket.id,
            status=TicketStatus.CALL_IN_PROGRESS,
            notes=f"Single dispatch initiated to {ticket.reporter.phone_e164}."
        )

        call_info = await calle_client.initiate_primary_call(ticket)
        return {
            "success": True,
            "ticket_id": ticket.id,
            "call_id": call_info.get("call_id"),
            "status": call_info.get("status"),
        }

    async def handle_call_webhook(self, payload: CalleWebhookPayload) -> Dict[str, Any]:
        """
        Process incoming CALL-E completion webhook.
        Parses structured JSON, records audit logs, and handles multi-agent escalation if needed.
        """
        metadata = payload.metadata or {}
        ticket_id = metadata.get("ticket_id")

        if not ticket_id:
            logger.warning("Received webhook without ticket_id in metadata: %s", payload)
            return {"status": "error", "message": "Missing ticket_id in metadata"}

        ticket = await db.get_ticket(ticket_id)
        if not ticket:
            logger.error("Webhook refers to non-existent ticket: %s", ticket_id)
            return {"status": "error", "message": f"Ticket '{ticket_id}' not found."}

        logger.info("Orchestrator: Processing completed call [%s] for Ticket #%s", payload.call_id, ticket_id)

        # 1. Parse structured result
        structured_data = None
        if payload.structured_result:
            try:
                structured_data = StructuredCallResult.model_validate(payload.structured_result)
            except Exception as e:
                logger.warning("Could not fully validate structured_result against Pydantic schema: %s", e)

        # 2. Record audit log
        audit_log = CallAuditLog(
            call_id=payload.call_id,
            agent_name=f"CivicScout-{ticket.department.name}",
            agent_department=ticket.department,
            started_at=datetime.datetime.utcnow() - datetime.timedelta(seconds=payload.duration_seconds),
            completed_at=datetime.datetime.utcnow(),
            duration_seconds=payload.duration_seconds,
            status="COMPLETED" if not payload.error else "FAILED",
            transcript=payload.transcript,
            structured_result=payload.structured_result,
        )
        await db.record_call_audit(ticket_id, audit_log)

        # 3. Check for Inter-Department Escalation Requirement
        if structured_data and structured_data.department_escalation_needed:
            target_dept = structured_data.target_escalation_department or DepartmentEnum.EMERGENCY_UTILITY_DISPATCH
            escalation_reason = structured_data.escalation_reason or "Escalation requested during voice triage."
            urgency = structured_data.updated_severity or TicketSeverity.CRITICAL_EMERGENCY

            logger.warning(
                "Orchestrator: ESCALATION DETECTED for Ticket #%s! Transferring from '%s' to '%s'. Reason: %s",
                ticket.id, ticket.department.value, target_dept.value, escalation_reason
            )

            # Record escalation in database
            escalation_detail = EscalationDetail(
                source_department=ticket.department,
                target_department=target_dept,
                reason=escalation_reason,
                urgency_level=urgency,
                triggered_at=datetime.datetime.utcnow()
            )
            await db.record_escalation(ticket_id, escalation_detail)

            # Dynamically provision & trigger SECONDARY CALL-E Agent
            secondary_call = await calle_client.initiate_escalation_call(
                ticket=ticket,
                escalation_reason=escalation_reason,
                source_dept=escalation_detail.source_department
            )

            return {
                "status": "escalated",
                "ticket_id": ticket_id,
                "escalation": {
                    "source_department": escalation_detail.source_department.value,
                    "target_department": target_dept.value,
                    "reason": escalation_reason,
                    "urgency": urgency.value,
                    "secondary_call_id": secondary_call.get("call_id"),
                },
                "structured_result": payload.structured_result,
            }

        # 4. Standard completion flow (No escalation needed)
        if structured_data:
            new_status = TicketStatus.FIELD_DISPATCHED if structured_data.incident_confirmed else TicketStatus.RESOLVED
            notes = f"Call Summary: {structured_data.call_summary} | Action Items: {', '.join(structured_data.action_items)}"
            
            if structured_data.verified_cross_street:
                ticket.cross_streets = structured_data.verified_cross_street
            
            await db.update_ticket_status(
                ticket_id=ticket_id,
                status=new_status,
                notes=notes,
                severity=structured_data.updated_severity
            )
        else:
            await db.update_ticket_status(
                ticket_id=ticket_id,
                status=TicketStatus.FIELD_DISPATCHED,
                notes="Call completed without structured schema parsing."
            )

        updated_ticket = await db.get_ticket(ticket_id)
        return {
            "status": "completed",
            "ticket_id": ticket_id,
            "final_ticket_status": updated_ticket.status.value if updated_ticket else "UNKNOWN",
            "structured_result": payload.structured_result,
        }


orchestrator = MultiAgentCivicOrchestrator()
