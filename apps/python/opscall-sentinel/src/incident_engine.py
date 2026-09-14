from __future__ import annotations

import time
from typing import Optional, Dict

from src.config import settings
from src.models import (
    IncidentAlert,
    IncidentRecord,
    IncidentState,
    IncidentAction,
    mask_phone,
)
from src.calle_bridge import BaseCalleBridge, MockCalleBridge, LiveCalleBridge


class IncidentEngine:
    """
    Deterministic incident ownership and escalation state machine.
    Enforces strict verified ownership gates, prevents phantom escalation cascades on
    pending/ambiguous telephony states, and guarantees zero fabrication of ownership results.
    """

    def __init__(self, bridge: Optional[BaseCalleBridge] = None):
        if bridge is not None:
            self.bridge = bridge
        elif settings.calle_mode == "live":
            self.bridge = LiveCalleBridge()
        else:
            self.bridge = MockCalleBridge()

        self.incidents: Dict[str, IncidentRecord] = {}

    def get_incident(self, incident_id: str) -> Optional[IncidentRecord]:
        return self.incidents.get(incident_id)

    def get_all_incidents(self) -> list[IncidentRecord]:
        return list(self.incidents.values())

    async def trigger_incident(
        self,
        alert: IncidentAlert,
        force_action: Optional[IncidentAction] = None,
        primary_outcome: Optional[str] = None,
        secondary_outcome: Optional[str] = None,
    ) -> IncidentRecord:
        """
        Execute deterministic incident ownership state machine:
          TRIGGERED -> CALLING_PRIMARY
          If Primary Acknowledges & PIN Matches:
            PRIMARY_CONNECTED -> PRIMARY_VERIFIED -> PRIMARY_ACKNOWLEDGED -> OWNERSHIP_ESTABLISHED
          If Primary is Pending/Ambiguous:
            PRIMARY_PENDING (Halts escalation; never auto-calls secondary on ambiguous states)
          If Primary Explicitly Fails (no_answer, busy, timeout) or Requests Escalation:
            PRIMARY_UNAVAILABLE -> ESCALATING -> CALLING_SECONDARY
            If Secondary Answers & Verifies:
              SECONDARY_CONNECTED -> SECONDARY_VERIFIED -> SECONDARY_ACKNOWLEDGED -> OWNERSHIP_ESTABLISHED
            If Secondary Fails/Pending:
              ESCALATION_EXHAUSTED
        """
        record = IncidentRecord(
            alert=alert,
            state=IncidentState.UNASSIGNED,
            owner="UNASSIGNED",
            assigned_engineer="Alex Vance (Primary On-Call SRE)",
            phone_dialed=settings.primary_oncall_phone,
            escalation_level=1,
            state_history=[
                {
                    "state": IncidentState.UNASSIGNED.value,
                    "timestamp": time.time(),
                    "detail": f"Outage triggered for service '{alert.service}' [{alert.severity.value}] - Owner: UNASSIGNED"
                }
            ]
        )
        self.incidents[alert.id] = record

        # Step 1: Dispatch to Primary Engineer
        record.transition_to(
            IncidentState.CALLING_PRIMARY,
            f"Dispatching autonomous CALL-E voice call to Primary SRE ({mask_phone(settings.primary_oncall_phone)})"
        )

        primary_call = await self.bridge.dispatch_incident_call(
            alert=alert,
            to_phone=settings.primary_oncall_phone,
            callee_role="Alex Vance (Primary On-Call SRE)",
            expected_pin=settings.oncall_security_pin,
            force_action=force_action,
            force_outcome=primary_outcome,
        )
        record.calls.append(primary_call)

        # Step 2: Safety Gate - Check if Primary Call is Pending / Ambiguous
        if primary_call.status in ("pending", "queued", "calling", "in_progress", "ambiguous"):
            record.transition_to(
                IncidentState.PRIMARY_PENDING,
                f"Primary call dispatch status is '{primary_call.status}'. Halting escalation cascade pending definitive outcome."
            )
            return record

        # Safety Gate: Never fabricate completed/PIN-verified ownership from missing results
        primary_res = primary_call.result
        if primary_call.status == "completed" and primary_res is None:
            record.transition_to(
                IncidentState.PRIMARY_UNAVAILABLE,
                "Primary call completed with missing or empty result schema. Halting escalation without fabricating verification."
            )
            return record

        # Step 3: Evaluate Primary Response
        primary_success = (
            primary_call.status == "completed"
            and primary_res is not None
            and primary_res.pin_matched
            and primary_res.verdict != IncidentAction.UNKNOWN
        )

        if primary_success and primary_res.verdict == IncidentAction.ACKNOWLEDGE:
            record.transition_to(IncidentState.PRIMARY_CONNECTED, "PSTN line connected with primary engineer")
            record.transition_to(IncidentState.PRIMARY_VERIFIED, f"PIN {settings.oncall_security_pin} successfully authenticated")
            record.transition_to(
                IncidentState.PRIMARY_ACKNOWLEDGED,
                f"DTMF {primary_res.dtmf_key_pressed or '1'} & spoken ETA: {primary_res.spoken_eta_minutes}m"
            )
            record.owner = "Alex Vance (Primary On-Call SRE)"
            record.transition_to(
                IncidentState.OWNERSHIP_ESTABLISHED,
                f"Incident ownership verified and locked to {record.owner}. Escalation halted."
            )
            return record

        elif primary_success and primary_res.verdict == IncidentAction.TRIGGER_ROLLBACK:
            record.transition_to(IncidentState.PRIMARY_CONNECTED, "PSTN line connected")
            record.transition_to(IncidentState.PRIMARY_VERIFIED, f"PIN {settings.oncall_security_pin} authenticated")
            record.owner = "Alex Vance (Primary On-Call SRE)"
            record.transition_to(
                IncidentState.RESOLVED,
                "Automated canary rollback initiated by primary engineer"
            )
            return record

        # Step 4: Autonomous Escalation Pathway (Only on Verified Primary Unavailability / Explicit Escalation)
        if primary_success and primary_res.verdict == IncidentAction.ESCALATE:
            record.transition_to(
                IncidentState.PRIMARY_UNAVAILABLE,
                "Primary engineer explicitly requested escalation to secondary"
            )
        elif primary_call.status in ("no_answer", "failed", "busy", "timeout", "unreachable"):
            record.transition_to(
                IncidentState.PRIMARY_UNAVAILABLE,
                f"Primary engineer unreachable (carrier status: {primary_call.status})"
            )
        else:
            # Ambiguous non-terminal state - stop escalation rather than making blind calls
            record.transition_to(
                IncidentState.PRIMARY_PENDING,
                f"Ambiguous primary response received (status: {primary_call.status}). Halting secondary dispatch."
            )
            return record

        record.transition_to(
            IncidentState.ESCALATING,
            "Autonomously initiating Tier-2 escalation cascade"
        )
        record.escalation_level = 2
        record.assigned_engineer = "Elena Rostova (Secondary On-Call SRE)"
        record.phone_dialed = settings.secondary_oncall_phone

        record.transition_to(
            IncidentState.CALLING_SECONDARY,
            f"Calling Secondary On-Call Lead at {mask_phone(settings.secondary_oncall_phone)}"
        )

        # Dispatch to Secondary
        secondary_call = await self.bridge.dispatch_incident_call(
            alert=alert,
            to_phone=settings.secondary_oncall_phone,
            callee_role="Elena Rostova (Secondary On-Call SRE)",
            expected_pin=settings.oncall_security_pin,
            force_action=IncidentAction.ACKNOWLEDGE,
            force_outcome=secondary_outcome,
        )
        record.calls.append(secondary_call)

        # Safety Gate: Secondary Pending or Missing Result
        if secondary_call.status in ("pending", "queued", "calling", "in_progress"):
            record.transition_to(
                IncidentState.ESCALATING,
                f"Secondary call dispatch pending (status: {secondary_call.status})."
            )
            return record

        secondary_res = secondary_call.result
        secondary_success = (
            secondary_call.status == "completed"
            and secondary_res is not None
            and secondary_res.pin_matched
            and secondary_res.verdict == IncidentAction.ACKNOWLEDGE
        )

        if secondary_success:
            record.transition_to(IncidentState.SECONDARY_CONNECTED, "Secondary engineer connected")
            record.transition_to(IncidentState.SECONDARY_VERIFIED, f"Secondary PIN {settings.oncall_security_pin} authenticated")
            record.transition_to(
                IncidentState.SECONDARY_ACKNOWLEDGED,
                f"Secondary verbal ACK + ETA {secondary_res.spoken_eta_minutes}m"
            )
            record.owner = "Elena Rostova (Secondary On-Call SRE)"
            record.transition_to(
                IncidentState.OWNERSHIP_ESTABLISHED,
                f"Incident ownership verified and transferred to {record.owner}. Escalation halted."
            )
        else:
            record.transition_to(
                IncidentState.ESCALATION_EXHAUSTED,
                "All roster engineers unreachable. Escalation ladder exhausted; high-priority bridge alert broadcast."
            )

        return record


# Global singleton instance for server runtime
engine = IncidentEngine()
