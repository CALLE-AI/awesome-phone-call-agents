import datetime
import logging
from typing import Any, Dict, List, Optional
from app.config import settings
from app.models import (
    CivicTicket,
    CitizenContact,
    DepartmentEnum,
    TicketStatus,
    TicketSeverity,
    CallAuditLog,
    EscalationDetail,
)

logger = logging.getLogger("CivicScout.Database")


class InMemoryFirestoreMock:
    """High-fidelity in-memory state store mimicking Google Cloud Firestore."""

    def __init__(self):
        self._tickets: Dict[str, Dict[str, Any]] = {}
        self._auth_codes: Dict[str, Dict[str, Any]] = {
            "PW-AUTH-9921": {
                "valid": True,
                "issuer": "Department of Transportation Safety Division",
                "expiry_date": "2026-12-31",
                "permissions": ["ROAD_CLOSURE_AUTHORITY", "EXCAVATION_PERMIT_TIER_2"],
                "contractor": "Apex Civil Infrastructure Ltd.",
            },
            "WAT-SEC-7704": {
                "valid": True,
                "issuer": "Metropolitan Water Reclamation Board",
                "expiry_date": "2026-10-15",
                "permissions": ["VALVE_SHUTOFF_AUTHORIZATION", "MAIN_LINE_ACCESS"],
                "contractor": "AquaWorks Emergency Services",
            },
            "EMERG-CHIEF-01": {
                "valid": True,
                "issuer": "City Council Office of Emergency Management",
                "expiry_date": "2027-01-01",
                "permissions": ["MULTI_AGENCY_DISPATCH", "CRITICAL_GRID_INTERVENTION"],
                "contractor": "Municipal Fire & Utility Combined Command",
            },
        }
        self._seed_sample_tickets()

    def _seed_sample_tickets(self):
        sample_tickets = [
            CivicTicket(
                id="TKT-311-ROADS-8812",
                title="Severe Road Subsidence and Sinkhole Formation",
                description="Resident reported major pavement cave-in near storm drain. Water heard rushing beneath surface.",
                department=DepartmentEnum.ROADS_INFRASTRUCTURE,
                location_address="742 Evergreen Terrace",
                cross_streets="Intersection of Elm St & Oak Avenue",
                gps_coordinates={"lat": 37.7749, "lng": -122.4194},
                severity=TicketSeverity.HIGH,
                status=TicketStatus.PENDING_OUTREACH,
                reporter=CitizenContact(
                    name="Sarah Jenkins",
                    phone_e164="+14155550198",
                    role="Resident Caller",
                    language="en-US",
                ),
                authorization_code="PW-AUTH-9921",
                created_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=15),
            ),
            CivicTicket(
                id="TKT-311-WATER-4421",
                title="High-Pressure Water Main Rupture with Street Flooding",
                description="Water spraying 10ft into air from utility access cover, submerging pedestrian pathway.",
                department=DepartmentEnum.WATER_WASTEWATER,
                location_address="1200 Market Street",
                cross_streets="Market St & 8th Street",
                gps_coordinates={"lat": 37.7792, "lng": -122.4162},
                severity=TicketSeverity.CRITICAL_EMERGENCY,
                status=TicketStatus.PENDING_OUTREACH,
                reporter=CitizenContact(
                    name="Marcus Vance",
                    phone_e164="+14155550244",
                    role="Field Superintendent",
                    language="en-US",
                ),
                authorization_code="WAT-SEC-7704",
                created_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=5),
            ),
            CivicTicket(
                id="TKT-311-TREE-3091",
                title="Fallen Pine Tree Leaning on Power Infrastructure",
                description="Heavy branch snapped during gale, hanging dangerously over municipal transformer.",
                department=DepartmentEnum.FORESTRY_PARKS,
                location_address="450 Skyline Boulevard",
                cross_streets="Skyline Blvd & Crestview Dr",
                gps_coordinates={"lat": 37.7258, "lng": -122.4921},
                severity=TicketSeverity.HIGH,
                status=TicketStatus.PENDING_OUTREACH,
                reporter=CitizenContact(
                    name="Elena Rostova",
                    phone_e164="+14155550312",
                    role="Resident Caller",
                    language="en-US",
                ),
                authorization_code=None,
                created_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=30),
            ),
        ]
        for t in sample_tickets:
            self._tickets[t.id] = t.model_dump(mode="json")


class DatabaseManager:
    """Manages Firestore persistent connection with graceful Mock fallback."""

    def __init__(self):
        self.use_mock = settings.FIRESTORE_USE_MOCK
        self.mock_store = InMemoryFirestoreMock()
        self._firestore_client = None

        if not self.use_mock:
            try:
                from google.cloud import firestore
                self._firestore_client = firestore.Client(
                    project=settings.GCP_PROJECT_ID,
                    database=settings.FIRESTORE_DATABASE
                )
                logger.info("Connected directly to Google Cloud Firestore: %s", settings.GCP_PROJECT_ID)
            except Exception as e:
                logger.warning("Could not initialize native Firestore client (%s). Falling back to InMemory Mock.", e)
                self.use_mock = True

    async def get_ticket(self, ticket_id: str) -> Optional[CivicTicket]:
        if self.use_mock:
            data = self.mock_store._tickets.get(ticket_id)
            if data:
                return CivicTicket.model_validate(data)
            return None
        
        doc = self._firestore_client.collection(settings.FIRESTORE_COLLECTION_TICKETS).document(ticket_id).get()
        if doc.exists:
            return CivicTicket.model_validate(doc.to_dict())
        return None

    async def save_ticket(self, ticket: CivicTicket) -> CivicTicket:
        ticket.updated_at = datetime.datetime.utcnow()
        ticket_data = ticket.model_dump(mode="json")

        if self.use_mock:
            self.mock_store._tickets[ticket.id] = ticket_data
            return ticket

        doc_ref = self._firestore_client.collection(settings.FIRESTORE_COLLECTION_TICKETS).document(ticket.id)
        doc_ref.set(ticket_data)
        return ticket

    async def list_tickets(
        self,
        status: Optional[TicketStatus] = None,
        department: Optional[DepartmentEnum] = None
    ) -> List[CivicTicket]:
        if self.use_mock:
            results = []
            for data in self.mock_store._tickets.values():
                t = CivicTicket.model_validate(data)
                if status and t.status != status:
                    continue
                if department and t.department != department:
                    continue
                results.append(t)
            # Sort newest first
            return sorted(results, key=lambda x: x.created_at, reverse=True)

        query = self._firestore_client.collection(settings.FIRESTORE_COLLECTION_TICKETS)
        if status:
            query = query.where("status", "==", status.value)
        if department:
            query = query.where("department", "==", department.value)
        
        docs = query.stream()
        return [CivicTicket.model_validate(d.to_dict()) for d in docs]

    async def get_pending_tickets(self) -> List[CivicTicket]:
        return await self.list_tickets(status=TicketStatus.PENDING_OUTREACH)

    async def update_ticket_status(
        self,
        ticket_id: str,
        status: TicketStatus,
        notes: Optional[str] = None,
        severity: Optional[TicketSeverity] = None
    ) -> Optional[CivicTicket]:
        ticket = await self.get_ticket(ticket_id)
        if not ticket:
            return None

        ticket.status = status
        if severity:
            ticket.severity = severity
        if notes:
            if ticket.field_dispatch_notes:
                ticket.field_dispatch_notes += f" | {notes}"
            else:
                ticket.field_dispatch_notes = notes

        ticket.updated_at = datetime.datetime.utcnow()
        await self.save_ticket(ticket)
        return ticket

    async def verify_auth_code(self, auth_code: str) -> Dict[str, Any]:
        """Verify municipal authorization permit or security code."""
        code_clean = auth_code.strip().upper()
        if self.use_mock:
            record = self.mock_store._auth_codes.get(code_clean)
            if record:
                return {
                    "valid": True,
                    "issuer": record["issuer"],
                    "expiry_date": record["expiry_date"],
                    "permissions": record["permissions"],
                    "contractor": record.get("contractor", "Municipal Services"),
                    "message": f"Authorization code '{code_clean}' successfully validated."
                }
            return {
                "valid": False,
                "issuer": "Unknown",
                "expiry_date": "",
                "permissions": [],
                "contractor": "Unverified",
                "message": f"Authorization code '{code_clean}' is INVALID or EXPIRED."
            }

        doc = self._firestore_client.collection(settings.FIRESTORE_COLLECTION_AUTH_CODES).document(code_clean).get()
        if doc.exists:
            data = doc.to_dict()
            return {
                "valid": True,
                "issuer": data.get("issuer", "Municipal Authority"),
                "expiry_date": data.get("expiry_date", ""),
                "permissions": data.get("permissions", []),
                "contractor": data.get("contractor", ""),
                "message": f"Authorization code '{code_clean}' verified via Cloud Firestore."
            }
        return {
            "valid": False,
            "issuer": "Unknown",
            "expiry_date": "",
            "permissions": [],
            "contractor": "Unverified",
            "message": f"Authorization code '{code_clean}' not found."
        }

    async def record_call_audit(self, ticket_id: str, audit_log: CallAuditLog) -> Optional[CivicTicket]:
        ticket = await self.get_ticket(ticket_id)
        if not ticket:
            return None
        ticket.audit_logs.append(audit_log)
        ticket.call_attempts += 1
        await self.save_ticket(ticket)
        return ticket

    async def record_escalation(self, ticket_id: str, escalation: EscalationDetail) -> Optional[CivicTicket]:
        ticket = await self.get_ticket(ticket_id)
        if not ticket:
            return None
        ticket.escalation_trail.append(escalation)
        ticket.status = TicketStatus.ESCALATED
        ticket.department = escalation.target_department
        ticket.severity = escalation.urgency_level
        await self.save_ticket(ticket)
        return ticket


db = DatabaseManager()
