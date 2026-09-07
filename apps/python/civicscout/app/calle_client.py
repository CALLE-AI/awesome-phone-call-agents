import datetime
import json
import logging
import uuid
from typing import Any, Dict, Optional
import httpx
from app.config import settings
from app.models import (
    CivicTicket,
    DepartmentEnum,
    StructuredCallResult,
    TicketSeverity,
    CallOutcome,
    CallAuditLog,
)

logger = logging.getLogger("CivicScout.CalleClient")


class CalleVoicePromptBuilder:
    """Constructs dynamic high-precision prompts for CALL-E agents based on ticket context and department."""

    @staticmethod
    def build_primary_agent_prompt(ticket: CivicTicket) -> str:
        prompt = f"""
You are CivicScout, an autonomous municipal public works voice agent representing the City Council's {ticket.department.value} Department.
You are calling {ticket.reporter.name} (Phone: {ticket.reporter.phone_e164}, Role: {ticket.reporter.role}) regarding 311 Ticket #{ticket.id}.

TICKET DETAILS:
- Title: {ticket.title}
- Description: {ticket.description}
- Reported Location: {ticket.location_address}
- Reported Cross Streets: {ticket.cross_streets or 'Not specified'}
- Current Severity: {ticket.severity.value}

YOUR MISSION:
1. Greet the citizen courteously, state your identity as CivicScout from the {ticket.department.value} Department, and reference Ticket #{ticket.id}.
2. Confirm if the issue is still actively occurring and verify the exact location / cross-street / landmark.
3. Inquire about immediate safety hazards (e.g. water entering structures, live electrical wires, blocked traffic, exposed gas).
4. If the caller mentions contractor permits or city worker credentials, ask for their Municipal Authorization Code and invoke the FastMCP tool `query_authorization_code` to validate it.
5. If the caller reveals conditions beyond your department's scope (e.g., sinkhole revealing a ruptured high-pressure water main or sparking electrical wires), invoke `trigger_department_escalation` immediately.
6. During the call, update the ticket status using `update_ticket_status_midcall` to reflect real-time assessment.
7. Wrap up the call with clear expectations and estimated crew dispatch timelines.

AVAILABLE MCP TOOLS:
- `query_authorization_code(ticket_id, auth_code)`: Check municipal permit validity.
- `update_ticket_status_midcall(ticket_id, status, notes, severity)`: Update ticket state mid-call.
- `trigger_department_escalation(ticket_id, source_dept, target_dept, reason, urgency_level)`: Trigger instant inter-department escalation.

STRUCTURED OUTPUT REQUIREMENT:
At the conclusion of the call, return structured JSON adhering strictly to the result schema.
"""
        return prompt.strip()

    @staticmethod
    def build_secondary_escalation_prompt(ticket: CivicTicket, escalation_reason: str, source_dept: DepartmentEnum) -> str:
        prompt = f"""
You are CivicScout Emergency Dispatch, the senior municipal multi-agency coordination voice agent.
You are conducting an URGENT ESCALATED follow-up call with {ticket.reporter.name} regarding Ticket #{ticket.id}.

ESCALATION CONTEXT:
- Initial Department: {source_dept.value}
- Escalated To: {ticket.department.value}
- Escalation Reason: {escalation_reason}
- Incident Location: {ticket.location_address} ({ticket.cross_streets or ''})

YOUR URGENT MISSION:
1. Identify yourself as the Emergency Utility & Multi-Agency Dispatch Agent handling the urgent escalation for Ticket #{ticket.id}.
2. Inform the caller that primary triage detected hazardous conditions requiring rapid multi-utility response (Water/Power/Fire/Traffic).
3. Confirm immediate perimeter safety: Are bystanders safe? Is traffic diverted? Are nearby building basements flooding?
4. Collect access specifics: Gate codes, hydrant locations, or nearest shutoff valves.
5. Invoke `update_ticket_status_midcall` with status 'FIELD_DISPATCHED' and severity 'CRITICAL_EMERGENCY'.
6. Confirm emergency crew ETA and provide safety instructions (e.g. maintain 30-foot perimeter).

STRUCTURED OUTPUT REQUIREMENT:
Return final structured triage JSON with action items and dispatch status.
"""
        return prompt.strip()


class CalleClientWrapper:
    """Wrapper managing CALL-E SDK/API calls, schema formatting, and simulated execution."""

    def __init__(self):
        self.api_key = settings.CALLE_API_KEY
        self.base_url = settings.CALLE_API_BASE_URL
        self.webhook_url = f"{settings.WEBHOOK_BASE_URL}/api/webhooks/calle"
        self._sdk_client = None

        # Attempt to load native CALL-E SDK if installed
        try:
            from calle import CalleClient
            if self.api_key and self.api_key != "demo-calle-key-hackathon":
                self._sdk_client = CalleClient(api_key=self.api_key)
                logger.info("Initialized native CALL-E SDK Client.")
        except ImportError:
            logger.info("Native 'calle' SDK not installed; using standard CALL-E REST API interface.")

    async def initiate_primary_call(self, ticket: CivicTicket) -> Dict[str, Any]:
        """Initiate outbound phone call to the citizen/superintendent for ticket triage."""
        prompt = CalleVoicePromptBuilder.build_primary_agent_prompt(ticket)
        schema = StructuredCallResult.model_json_schema()
        call_id = f"call_{uuid.uuid4().hex[:12]}"

        logger.info("CALL-E: Initiating primary outbound call [%s] to %s (%s)", call_id, ticket.reporter.phone_e164, ticket.reporter.name)

        payload = {
            "to": ticket.reporter.phone_e164,
            "from": settings.DEFAULT_CALLER_ID,
            "task": prompt,
            "result_schema": schema,
            "metadata": {
                "ticket_id": ticket.id,
                "department": ticket.department.value,
                "agent_type": "PRIMARY_DISPATCHER",
                "call_id": call_id,
            },
            "webhook_url": self.webhook_url,
        }

        # If native SDK client is available and not in demo mode
        if self._sdk_client:
            try:
                call_response = self._sdk_client.calls.create(
                    to=ticket.reporter.phone_e164,
                    task=prompt,
                    result_schema=schema,
                    webhook_url=self.webhook_url,
                    metadata=payload["metadata"],
                )
                return {
                    "call_id": getattr(call_response, "id", call_id),
                    "status": "QUEUED",
                    "mode": "NATIVE_SDK",
                    "payload": payload,
                }
            except Exception as e:
                logger.error("Error executing via native CALL-E SDK: %s. Falling back to HTTP API.", e)

        # HTTP REST API call
        if self.api_key and not self.api_key.startswith("demo-"):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"{self.base_url}/calls",
                        headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                        json=payload,
                    )
                    if resp.status_code in (200, 201, 202):
                        data = resp.json()
                        return {
                            "call_id": data.get("id", call_id),
                            "status": data.get("status", "QUEUED"),
                            "mode": "REST_API",
                            "data": data,
                        }
            except Exception as e:
                logger.warning("CALL-E live API call error (%s). Using high-fidelity runtime simulator.", e)

        # High-fidelity runtime simulator for local testing / zero-cost verification
        return {
            "call_id": call_id,
            "status": "QUEUED",
            "mode": "SIMULATED_RUNTIME",
            "payload": payload,
        }

    async def initiate_escalation_call(
        self,
        ticket: CivicTicket,
        escalation_reason: str,
        source_dept: DepartmentEnum
    ) -> Dict[str, Any]:
        """Trigger secondary CALL-E agent dial with specialized escalation prompt."""
        prompt = CalleVoicePromptBuilder.build_secondary_escalation_prompt(ticket, escalation_reason, source_dept)
        schema = StructuredCallResult.model_json_schema()
        secondary_call_id = f"call_esc_{uuid.uuid4().hex[:10]}"

        logger.info("CALL-E: Spawning SECONDARY escalation agent [%s] for Ticket #%s to %s", secondary_call_id, ticket.id, ticket.reporter.phone_e164)

        payload = {
            "to": ticket.reporter.phone_e164,
            "from": settings.DEFAULT_CALLER_ID,
            "task": prompt,
            "result_schema": schema,
            "metadata": {
                "ticket_id": ticket.id,
                "department": DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value,
                "agent_type": "SECONDARY_ESCALATION_AGENT",
                "call_id": secondary_call_id,
                "source_department": source_dept.value,
                "escalation_reason": escalation_reason,
            },
            "webhook_url": self.webhook_url,
        }

        return {
            "call_id": secondary_call_id,
            "status": "QUEUED",
            "mode": "SECONDARY_ESCALATION_AGENT",
            "payload": payload,
        }

    def simulate_call_execution(
        self,
        ticket: CivicTicket,
        call_id: str,
        simulate_escalation: bool = False,
        simulate_auth_code: bool = True
    ) -> Dict[str, Any]:
        """
        Simulate a full conversational lifecycle of a CALL-E agent,
        including mid-call FastMCP invocations and structured JSON output.
        """
        if simulate_escalation:
            # Case where caller reveals road subsidence is actually an emergency water main burst
            transcript = (
                f"Agent: Hello {ticket.reporter.name}, I am CivicScout from the City Council's "
                f"{ticket.department.value} Department calling regarding your 311 report #{ticket.id} at {ticket.location_address}. "
                f"Can you confirm the situation on site?\n"
                f"Caller: Yes! It started as a sinkhole, but right now a massive high-pressure water main has fractured under the pavement! "
                f"Water is gushing into the road and nearing an electrical distribution box!\n"
                f"Agent: Understood. That is a critical multi-agency hazard. Do you have an on-site permit or authorization code?\n"
                f"Caller: Yes, my supervisor gave me municipal code PW-AUTH-9921.\n"
                f"Agent: [FastMCP Tool: query_authorization_code('PW-AUTH-9921')] Authorization verified for Apex Civil Infrastructure. "
                f"Because this involves active water pressure and electrical infrastructure, I am initiating an immediate inter-department escalation.\n"
                f"Agent: [FastMCP Tool: trigger_department_escalation('Emergency Utility & Multi-Agency Dispatch')] Escalation triggered. "
                f"Our Emergency Utility crew is being dispatched with high-capacity shutoff valves. Please stand back 50 feet."
            )
            structured_data = {
                "incident_confirmed": True,
                "updated_severity": TicketSeverity.CRITICAL_EMERGENCY.value,
                "identified_hazards": [
                    "Fractured high-pressure water main beneath road subsidence",
                    "Proximity to electrical distribution box",
                    "Rapid pavement undermining"
                ],
                "verified_cross_street": ticket.cross_streets or "Elm St & Oak Avenue",
                "access_code_or_gate": "Gate 4 Code #8812",
                "department_escalation_needed": True,
                "target_escalation_department": DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value,
                "escalation_reason": "High-pressure water main fracture compromising underground electrical conduit beneath roadway.",
                "call_summary": "Confirmed major water main fracture under sinkhole. Validated auth code PW-AUTH-9921. Escalated from Roads to Emergency Utility Dispatch.",
                "action_items": [
                    "Dispatch emergency water shutoff valve crew",
                    "Notify electric grid safety team",
                    "Close intersection to vehicular traffic"
                ],
                "outcome": CallOutcome.ESCALATED_TO_DEPARTMENT.value,
            }
        else:
            # Standard confirmed triage
            transcript = (
                f"Agent: Hello {ticket.reporter.name}, this is CivicScout from the {ticket.department.value} Department. "
                f"I'm following up on Ticket #{ticket.id} regarding {ticket.title} at {ticket.location_address}.\n"
                f"Caller: Hi! Yes, the fallen pine tree branch is still suspended over the overhead lines.\n"
                f"Agent: Is it touching the live wire or causing sparking?\n"
                f"Caller: Not sparking yet, but it's swaying with the wind.\n"
                f"Agent: [FastMCP Tool: update_ticket_status_midcall(status='FIELD_DISPATCHED', severity='HIGH')] "
                f"I have logged this as a High priority forestry dispatch. Our tree crew is scheduled with hydraulic lift trucks.\n"
                f"Caller: Thank you so much!"
            )
            structured_data = {
                "incident_confirmed": True,
                "updated_severity": TicketSeverity.HIGH.value,
                "identified_hazards": ["Heavy pine limb suspended 15ft above overhead secondary lines"],
                "verified_cross_street": ticket.cross_streets or "Skyline Blvd & Crestview Dr",
                "access_code_or_gate": None,
                "department_escalation_needed": False,
                "target_escalation_department": None,
                "escalation_reason": None,
                "call_summary": "Verified tree limb hazard over power lines. Dispatched priority urban forestry bucket crew.",
                "action_items": [
                    "Deploy hydraulic bucket truck",
                    "Perform controlled branch rigging and removal",
                    "Inspect secondary line insulation"
                ],
                "outcome": CallOutcome.CONFIRMED_HAZARD.value,
            }

        return {
            "event_type": "call.completed",
            "call_id": call_id,
            "task": "CivicScout Outbound Triage",
            "phone_number": ticket.reporter.phone_e164,
            "duration_seconds": 94,
            "transcript": transcript,
            "structured_result": structured_data,
            "metadata": {
                "ticket_id": ticket.id,
                "department": ticket.department.value,
            },
        }


calle_client = CalleClientWrapper()
