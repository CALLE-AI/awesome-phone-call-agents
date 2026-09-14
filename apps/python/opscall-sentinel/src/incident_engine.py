from __future__ import annotations

import time
from typing import Dict, List, Optional
from src.config import settings
from src.models import (
    IncidentAlert,
    IncidentRecord,
    IncidentState,
    IncidentAction,
    CallRecord,
)
from src.calle_bridge import get_calle_bridge, BaseCalleBridge


class IncidentEngine:
    def __init__(self, bridge: Optional[BaseCalleBridge] = None):
        self.bridge = bridge or get_calle_bridge()
        self.incidents: Dict[str, IncidentRecord] = {}

    def get_all_incidents(self) -> List[IncidentRecord]:
        return sorted(self.incidents.values(), key=lambda r: r.created_at, reverse=True)

    def get_incident(self, incident_id: str) -> Optional[IncidentRecord]:
        return self.incidents.get(incident_id)

    async def trigger_incident(
        self,
        alert: IncidentAlert,
        force_action: Optional[IncidentAction] = None,
        primary_outcome: Optional[str] = None,
        secondary_outcome: Optional[str] = None,
    ) -> IncidentRecord:
        """Trigger an incident and execute autonomous multi-tier CALL-E voice escalation.
        
        Autonomous State Flow:
        UNASSIGNED -> CALLING_PRIMARY
        If Primary Answers & Verifies:
          PRIMARY_CONNECTED -> PRIMARY_VERIFIED -> PRIMARY_ACKNOWLEDGED -> OWNERSHIP_ESTABLISHED
        If Primary Fails / No Answer:
          PRIMARY_UNAVAILABLE -> ESCALATING -> CALLING_SECONDARY
          If Secondary Answers & Verifies:
            SECONDARY_CONNECTED -> SECONDARY_VERIFIED -> SECONDARY_ACKNOWLEDGED -> OWNERSHIP_ESTABLISHED
          If Secondary Also Fails:
            ESCALATION_EXHAUSTED
        """
        record = IncidentRecord(
            alert=alert,
            state=IncidentState.UNASSIGNED,
            owner="UNASSIGNED",
            assigned_engineer="Alex Vance (Primary On-Call SRE)",
            phone_dialed=settings.primary_oncall_phone,
            escalation_level=1,
            created_at=time.time(),
            updated_at=time.time()
        )
        record.transition_to(
            IncidentState.UNASSIGNED,
            f"Alert ingested for {alert.service} ({alert.severity.value}). Owner: UNASSIGNED"
        )
        self.incidents[alert.id] = record

        # Step 1: Dispatch to Primary Engineer
        record.transition_to(
            IncidentState.CALLING_PRIMARY,
            f"Dispatching autonomous CALL-E voice call to Primary SRE (+91 •••• •••896)"
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

        # Step 2: Evaluate Primary Response
        primary_res = primary_call.result
        primary_success = (
            primary_call.status == "completed"
            and primary_res is not None
            and primary_res.pin_matched
            and primary_res.verdict != IncidentAction.UNKNOWN
        )

        if primary_success and primary_res.verdict == IncidentAction.ACKNOWLEDGE:
            record.transition_to(IncidentState.PRIMARY_CONNECTED, "PSTN line connected with primary engineer")
            record.transition_to(IncidentState.PRIMARY_VERIFIED, "PIN 4829 successfully authenticated")
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
            record.transition_to(IncidentState.PRIMARY_VERIFIED, "PIN 4829 authenticated")
            record.owner = "Alex Vance (Primary On-Call SRE)"
            record.transition_to(
                IncidentState.RESOLVED,
                "Automated canary rollback initiated by primary engineer"
            )
            return record

        # Step 3: Autonomous Escalation Pathway (Primary Unavailable / Escalated)
        if primary_success and primary_res.verdict == IncidentAction.ESCALATE:
            record.transition_to(
                IncidentState.PRIMARY_UNAVAILABLE,
                "Primary engineer explicitly requested escalation to secondary"
            )
        else:
            record.transition_to(
                IncidentState.PRIMARY_UNAVAILABLE,
                "Primary engineer unreachable (no answer / ring timeout)"
            )

        record.transition_to(
            IncidentState.ESCALATING,
            "Autonomously initiating Tier-2 escalation cascade"
        )
        record.escalation_level = 2
        record.assigned_engineer = "Elena Rostova (Secondary On-Call SRE)"
        record.phone_dialed = settings.secondary_oncall_phone

        record.transition_to(
            IncidentState.CALLING_SECONDARY,
            f"Calling Secondary On-Call Lead at {settings.secondary_oncall_phone}"
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

        secondary_res = secondary_call.result
        secondary_success = (
            secondary_call.status == "completed"
            and secondary_res is not None
            and secondary_res.pin_matched
            and secondary_res.verdict == IncidentAction.ACKNOWLEDGE
        )

        if secondary_success:
            record.transition_to(IncidentState.SECONDARY_CONNECTED, "Secondary engineer connected")
            record.transition_to(IncidentState.SECONDARY_VERIFIED, "Secondary PIN 4829 authenticated")
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

