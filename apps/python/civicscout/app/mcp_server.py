import datetime
import logging
from typing import Any, Dict, Optional
from fastmcp import FastMCP
from app.config import settings
from app.database import db
from app.models import TicketStatus, TicketSeverity, DepartmentEnum, EscalationDetail

logger = logging.getLogger("CivicScout.FastMCP")

# Instantiate FastMCP server
mcp = FastMCP(
    name=settings.MCP_SERVER_NAME,
    version=settings.MCP_SERVER_VERSION,
)


@mcp.tool()
async def query_authorization_code(ticket_id: str, auth_code: str) -> Dict[str, Any]:
    """
    Validate a municipal job permit, contractor security token, or city worker authorization code.
    Use this during a live call when the citizen or superintendent provides an authorization code.
    
    Args:
        ticket_id: The 311 ticket ID being investigated (e.g. 'TKT-311-ROADS-8812').
        auth_code: The authorization code provided by the caller (e.g. 'PW-AUTH-9921').
    """
    logger.info("FastMCP: Validating authorization code '%s' for ticket '%s'", auth_code, ticket_id)
    auth_result = await db.verify_auth_code(auth_code)
    
    # Check ticket existence
    ticket = await db.get_ticket(ticket_id)
    if ticket:
        if auth_result.get("valid"):
            ticket.authorization_code = auth_code.strip().upper()
            await db.save_ticket(ticket)
            
    return {
        "status": "success" if auth_result.get("valid") else "unauthorized",
        "ticket_id": ticket_id,
        "auth_code": auth_code,
        "valid": auth_result.get("valid", False),
        "issuer": auth_result.get("issuer", "Unknown"),
        "expiry_date": auth_result.get("expiry_date", ""),
        "permissions": auth_result.get("permissions", []),
        "contractor": auth_result.get("contractor", "Unverified"),
        "message": auth_result.get("message", "Validation completed.")
    }


@mcp.tool()
async def update_ticket_status_midcall(
    ticket_id: str,
    status: str,
    notes: str,
    severity: Optional[str] = None
) -> Dict[str, Any]:
    """
    Update ticket status, field dispatch notes, and severity in real time while on the phone with the citizen.
    
    Args:
        ticket_id: The 311 ticket ID (e.g. 'TKT-311-ROADS-8812').
        status: New status ('PENDING_OUTREACH', 'CALL_IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'FIELD_DISPATCHED').
        notes: Real-time notes gathered from caller regarding ground truth.
        severity: Optional updated severity ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL_EMERGENCY').
    """
    logger.info("FastMCP: Updating ticket '%s' status to '%s' mid-call. Notes: %s", ticket_id, status, notes)
    try:
        status_enum = TicketStatus(status)
    except ValueError:
        return {
            "success": False,
            "error": f"Invalid status '{status}'. Valid statuses: {[s.value for s in TicketStatus]}"
        }

    severity_enum = None
    if severity:
        try:
            severity_enum = TicketSeverity(severity)
        except ValueError:
            logger.warning("Invalid severity '%s' passed to update_ticket_status_midcall", severity)

    updated_ticket = await db.update_ticket_status(
        ticket_id=ticket_id,
        status=status_enum,
        notes=notes,
        severity=severity_enum
    )

    if not updated_ticket:
        return {
            "success": False,
            "error": f"Ticket '{ticket_id}' not found in database."
        }

    return {
        "success": True,
        "ticket_id": ticket_id,
        "applied_status": updated_ticket.status.value,
        "severity": updated_ticket.severity.value,
        "updated_at": updated_ticket.updated_at.isoformat(),
        "message": f"Ticket {ticket_id} updated to {updated_ticket.status.value} mid-call."
    }


@mcp.tool()
async def trigger_department_escalation(
    ticket_id: str,
    source_dept: str,
    target_dept: str,
    reason: str,
    urgency_level: str = "HIGH"
) -> Dict[str, Any]:
    """
    Escalate a ticket to another municipal department or emergency utility dispatch mid-call.
    Use this if the primary department (e.g. Roads) discovers hazards requiring Water, Electrical, or Emergency Services.
    
    Args:
        ticket_id: The ticket ID being escalated.
        source_dept: Current department handling the ticket.
        target_dept: Target department to receive transfer (e.g. 'Emergency Utility & Multi-Agency Dispatch', 'Water & Wastewater').
        reason: Specific reason for escalation (e.g. 'Sinkhole has live broken high-pressure gas/water line beneath').
        urgency_level: Urgency ('MEDIUM', 'HIGH', 'CRITICAL_EMERGENCY').
    """
    logger.info("FastMCP: Escalating ticket '%s' from '%s' to '%s'. Reason: %s", ticket_id, source_dept, target_dept, reason)
    try:
        source_enum = DepartmentEnum(source_dept)
    except ValueError:
        source_enum = DepartmentEnum.ROADS_INFRASTRUCTURE

    try:
        target_enum = DepartmentEnum(target_dept)
    except ValueError:
        target_enum = DepartmentEnum.EMERGENCY_UTILITY_DISPATCH

    try:
        urgency_enum = TicketSeverity(urgency_level)
    except ValueError:
        urgency_enum = TicketSeverity.HIGH

    escalation = EscalationDetail(
        source_department=source_enum,
        target_department=target_enum,
        reason=reason,
        urgency_level=urgency_enum,
        triggered_at=datetime.datetime.utcnow()
    )

    ticket = await db.record_escalation(ticket_id, escalation)
    if not ticket:
        return {
            "success": False,
            "error": f"Ticket '{ticket_id}' could not be located for escalation."
        }

    return {
        "success": True,
        "ticket_id": ticket_id,
        "escalation_status": "ESCALATION_TRIGGERED",
        "source_department": source_enum.value,
        "target_department": target_enum.value,
        "urgency_level": urgency_enum.value,
        "message": f"Escalation successfully logged. Secondary agent dispatch initiated for {target_enum.value}."
    }


@mcp.tool()
async def lookup_ticket_details(ticket_id: str) -> Dict[str, Any]:
    """
    Retrieve full details of a civic ticket including location, description, reporter info, and previous call audits.
    
    Args:
        ticket_id: Unique 311 ticket identifier.
    """
    ticket = await db.get_ticket(ticket_id)
    if not ticket:
        return {"found": False, "error": f"Ticket '{ticket_id}' not found."}

    return {
        "found": True,
        "ticket": ticket.model_dump(mode="json")
    }
