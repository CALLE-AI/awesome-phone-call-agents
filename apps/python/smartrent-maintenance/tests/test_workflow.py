"""Tests for SmartRent Maintenance Coordinator workflow."""

import asyncio
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import pytest
from app.config import CalleConfig
from app.calle_client import CalleService
from app.models import (
    CallStatus,
    CreateRequestPayload,
    IssueType,
    MaintenanceRequest,
    Urgency,
    Vendor,
    WorkflowState,
)
from app.workflows import MaintenanceWorkflow


@pytest.fixture
def dry_run_service():
    """Create a CALL-E service in dry-run mode."""
    config = CalleConfig(dry_run=True)
    return CalleService(config)


@pytest.fixture
def workflow(dry_run_service):
    """Create a workflow with dry-run service."""
    return MaintenanceWorkflow(dry_run_service)


@pytest.fixture
def sample_request():
    """Create a sample maintenance request."""
    return MaintenanceRequest(
        tenant_name="John Smith",
        tenant_phone="+15551234567",
        unit_number="4B",
        property_name="SmartRent Demo Property",
        initial_description="Kitchen sink is leaking",
    )


# ─── Unit Tests ──────────────────────────────────────────────────────────────

class TestCalleService:
    """Test CALL-E service wrapper."""

    def test_dry_run_mode(self, dry_run_service):
        assert dry_run_service.is_dry_run is True

    @pytest.mark.asyncio
    async def test_tenant_intake_dry_run(self, dry_run_service):
        result = await dry_run_service.call_tenant_intake(
            phone="+15551234567",
            tenant_name="John Smith",
            unit_number="4B",
            property_name="Test Property",
            initial_description="Sink leak",
        )
        assert result.status == CallStatus.COMPLETED
        assert result.task_completed is True
        assert result.structured_result is not None
        assert result.structured_result["issue_type"] == "plumbing"
        assert result.structured_result["urgency"] == "urgent"
        assert len(result.transcript) > 0
        assert len(result.evidence) > 0

    @pytest.mark.asyncio
    async def test_vendor_dispatch_dry_run(self, dry_run_service):
        result = await dry_run_service.call_vendor_dispatch(
            vendor_phone="+15550100001",
            vendor_name="Mike's Plumbing",
            issue_type="plumbing",
            urgency="urgent",
            location="kitchen",
            property_name="Test Property",
            unit_number="4B",
        )
        assert result.status == CallStatus.COMPLETED
        assert result.structured_result["available"] == "yes"
        assert result.structured_result["eta"] is not None
        assert result.structured_result["cost_estimate"] is not None

    @pytest.mark.asyncio
    async def test_tenant_confirm_dry_run(self, dry_run_service):
        result = await dry_run_service.call_tenant_confirm(
            phone="+15551234567",
            tenant_name="John Smith",
            vendor_name="Mike's Plumbing",
            eta="within 2 hours",
            cost_estimate="$150-250",
            unit_number="4B",
        )
        assert result.status == CallStatus.COMPLETED
        assert result.structured_result["confirmed"] == "yes"


class TestWorkflow:
    """Test the multi-call workflow orchestrator."""

    @pytest.mark.asyncio
    async def test_tenant_intake_step(self, workflow, sample_request):
        result = await workflow.step_tenant_intake(sample_request)
        assert result.state == WorkflowState.TENANT_CALLED
        assert result.issue_type == IssueType.PLUMBING
        assert result.urgency == Urgency.URGENT
        assert result.location_in_unit is not None
        assert len(result.calls) == 1
        assert len(result.timeline) > 0

    @pytest.mark.asyncio
    async def test_vendor_dispatch_step(self, workflow, sample_request):
        # First do tenant intake
        sample_request = await workflow.step_tenant_intake(sample_request)
        assert sample_request.state == WorkflowState.TENANT_CALLED

        # Then dispatch vendor
        result = await workflow.step_vendor_dispatch(sample_request)
        assert result.state == WorkflowState.VENDOR_FOUND
        assert result.assigned_vendor is not None
        assert result.vendor_eta is not None
        assert result.vendor_cost_estimate is not None
        assert len(result.calls) == 2

    @pytest.mark.asyncio
    async def test_tenant_confirm_step(self, workflow, sample_request):
        # Run first two steps
        sample_request = await workflow.step_tenant_intake(sample_request)
        sample_request = await workflow.step_vendor_dispatch(sample_request)
        assert sample_request.state == WorkflowState.VENDOR_FOUND

        # Confirm
        result = await workflow.step_tenant_confirm(sample_request)
        assert result.state == WorkflowState.COMPLETED
        assert result.tenant_confirmed is True
        assert len(result.calls) == 3

    @pytest.mark.asyncio
    async def test_full_workflow(self, workflow, sample_request):
        result = await workflow.run_full_workflow(sample_request)
        assert result.state == WorkflowState.COMPLETED
        assert result.tenant_confirmed is True
        assert result.issue_type == IssueType.PLUMBING
        assert result.urgency == Urgency.URGENT
        assert result.assigned_vendor is not None
        assert result.vendor_eta is not None
        assert len(result.calls) == 3
        assert len(result.timeline) >= 6  # At least 6 events

    @pytest.mark.asyncio
    async def test_vendor_matching(self, workflow):
        # Plumbing issue should match plumbing vendors
        vendors = workflow.get_vendors_for_issue("plumbing")
        assert len(vendors) >= 1
        assert any("plumbing" in v.specialties for v in vendors)

        # Electrical issue
        vendors = workflow.get_vendors_for_issue("electrical")
        assert len(vendors) >= 1


class TestModels:
    """Test data models."""

    def test_create_request(self):
        req = MaintenanceRequest(
            tenant_name="Jane Doe",
            tenant_phone="+15559876543",
            unit_number="10A",
        )
        assert req.id.startswith("MR-")
        assert req.state == WorkflowState.CREATED
        assert req.calls == []
        assert req.timeline == []

    def test_timeline_events(self, sample_request):
        sample_request.add_timeline_event("test_event", "Test details")
        assert len(sample_request.timeline) == 1
        assert sample_request.timeline[0]["event"] == "test_event"
        assert sample_request.timeline[0]["details"] == "Test details"

    def test_create_payload(self):
        payload = CreateRequestPayload(
            tenant_name="John",
            tenant_phone="+15551234567",
            unit_number="4B",
            simulate_cascade=True,
        )
        assert payload.property_name == "SmartRent Demo Property"
        assert payload.simulate_cascade is True


class TestEnterpriseResilience:
    """Test enterprise reliability, cascade dispatch, and edge case handling."""

    @pytest.mark.asyncio
    async def test_vendor_cascade_recovery(self, workflow, sample_request):
        """Test that when simulate_cascade is active, the first vendor declines and workflow cascades to secondary vendor."""
        sample_request.simulate_cascade = True
        sample_request = await workflow.step_tenant_intake(sample_request)
        result = await workflow.step_vendor_dispatch(sample_request)

        assert result.state == WorkflowState.VENDOR_FOUND
        assert result.assigned_vendor is not None
        assert len(result.calls) == 3  # 1 intake + 2 vendor dispatch calls
        cascade_events = [e for e in result.timeline if e["event"] == "vendor_cascade_triggered"]
        assert len(cascade_events) == 1

    @pytest.mark.asyncio
    async def test_all_vendors_unavailable_escalation(self, sample_request):
        """Test that when all candidates are unavailable, the workflow fails gracefully and escalates."""
        config = CalleConfig(dry_run=True)
        service = CalleService(config)
        single_vendor = [Vendor(id="v-busy", name="Busy Contractor", phone="+15550100099", specialties=["plumbing"])]
        wf = MaintenanceWorkflow(service, vendors=single_vendor)

        sample_request = await wf.step_tenant_intake(sample_request)
        sample_request.simulate_cascade = True
        result = await wf.step_vendor_dispatch(sample_request)

        assert result.state == WorkflowState.FAILED
        assert any(e["event"] == "escalated_to_manager" for e in result.timeline)

    @pytest.mark.asyncio
    async def test_tenant_confirm_reschedule(self, workflow, sample_request):
        """Test that a reschedule response resets the state to TENANT_CALLED."""
        from unittest.mock import patch
        from datetime import datetime, timezone
        from app.models import CallRecord, CallStatus

        sample_request = await workflow.step_tenant_intake(sample_request)
        sample_request = await workflow.step_vendor_dispatch(sample_request)

        with patch.object(workflow.calle, "call_tenant_confirm") as mock_confirm:
            mock_confirm.return_value = CallRecord(
                call_id="mock-reschedule",
                call_type="tenant_confirm",
                phone=sample_request.tenant_phone,
                status=CallStatus.COMPLETED,
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
                structured_result={"confirmed": "reschedule", "preferred_time": "Friday 2pm"},
                task_completed=True,
                confidence_score=0.92,
            )
            result = await workflow.step_tenant_confirm(sample_request)
            assert result.state == WorkflowState.TENANT_CALLED
            assert result.tenant_confirmed is False
            assert any(e["event"] == "tenant_reschedule" for e in result.timeline)

    @pytest.mark.asyncio
    async def test_tenant_confirm_declined(self, workflow, sample_request):
        """Test handling when tenant declines the vendor visit."""
        from unittest.mock import patch
        from datetime import datetime, timezone
        from app.models import CallRecord, CallStatus

        sample_request = await workflow.step_tenant_intake(sample_request)
        sample_request = await workflow.step_vendor_dispatch(sample_request)

        with patch.object(workflow.calle, "call_tenant_confirm") as mock_confirm:
            mock_confirm.return_value = CallRecord(
                call_id="mock-declined",
                call_type="tenant_confirm",
                phone=sample_request.tenant_phone,
                status=CallStatus.COMPLETED,
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
                structured_result={"confirmed": "no", "notes": "No longer needed"},
                task_completed=True,
                confidence_score=0.95,
            )
            result = await workflow.step_tenant_confirm(sample_request)
            assert result.state == WorkflowState.FAILED
            assert result.tenant_confirmed is False
            assert any(e["event"] == "tenant_declined" for e in result.timeline)

    def test_vendor_roster_cascade_coverage(self, workflow):
        """Verify the vendor roster covers all required property maintenance specialties with fallback redundancy."""
        for issue in ["plumbing", "electrical", "hvac", "appliance", "structural"]:
            vendors = workflow.get_vendors_for_issue(issue)
            assert len(vendors) >= 2, f"Expected at least 2 vendors for {issue} to support cascade"

    @pytest.mark.asyncio
    async def test_concurrency_independent_requests(self, workflow):
        """Verify multiple simultaneous requests execute independently without state corruption."""
        req1 = MaintenanceRequest(tenant_name="Alice", tenant_phone="+15550101001", unit_number="1A")
        req2 = MaintenanceRequest(tenant_name="Bob", tenant_phone="+15550101002", unit_number="2B")

        res1, res2 = await asyncio.gather(
            workflow.run_full_workflow(req1),
            workflow.run_full_workflow(req2),
        )
        assert res1.id != res2.id
        assert res1.state == WorkflowState.COMPLETED
        assert res2.state == WorkflowState.COMPLETED
        assert res1.tenant_name == "Alice"
        assert res2.tenant_name == "Bob"

    @pytest.mark.asyncio
    async def test_confidence_and_evidence_preservation(self):
        """Ensure evidence quotes and confidence scores remain intact on call records."""
        config = CalleConfig(dry_run=True)
        service = CalleService(config)
        record = await service.call_tenant_intake(
            phone="+15551234567",
            tenant_name="Test Tenant",
            unit_number="3C",
            property_name="Demo",
        )
        assert record.confidence_score is not None
        assert record.confidence_score >= 0.90
        assert len(record.evidence) >= 1


class TestAPIEndpoints:
    """Test REST API endpoints and payload serialization."""

    def test_dashboard_endpoint(self):
        from fastapi.testclient import TestClient
        from app.main import app
        with TestClient(app) as client:
            res = client.get("/api/dashboard")
            assert res.status_code == 200
            data = res.json()
            assert "total_requests" in data
            assert "requests" in data

    def test_create_and_fetch_request_api(self):
        from fastapi.testclient import TestClient
        from app.main import app
        with TestClient(app) as client:
            res = client.post(
                "/api/requests",
                json={
                    "tenant_name": "API Tester",
                    "tenant_phone": "+15550109999",
                    "unit_number": "5F",
                    "initial_description": "Clogged bathroom sink",
                    "simulate_cascade": True,
                },
            )
            assert res.status_code == 200
            created = res.json()
            assert created["id"].startswith("MR-")
            assert created["tenant_name"] == "API Tester"
            assert created["simulate_cascade"] is True

            # Fetch details
            fetch_res = client.get(f"/api/requests/{created['id']}")
            assert fetch_res.status_code == 200
            assert fetch_res.json()["id"] == created["id"]

    def test_sqlite_persistence(self, tmp_path):
        from app.db import init_db, save_request, get_request, list_requests
        from app.models import MaintenanceRequest
        test_db = tmp_path / "test_smartrent.db"
        init_db(test_db)

        req = MaintenanceRequest(
            tenant_name="Persisted User",
            tenant_phone="+15550109876",
            unit_number="8B",
            initial_description="Testing SQLite storage",
        )
        save_request(req, test_db)

        loaded = get_request(req.id, test_db)
        assert loaded is not None
        assert loaded.id == req.id
        assert loaded.tenant_name == "Persisted User"

        all_reqs = list_requests(test_db)
        assert len(all_reqs) >= 1
        assert any(r.id == req.id for r in all_reqs)

    def test_webhook_matching(self):
        import uuid
        from fastapi.testclient import TestClient
        from app.main import app, requests_store
        from app.models import MaintenanceRequest, CallRecord, CallStatus

        unique_call_id = f"call-wh-{uuid.uuid4().hex[:8]}"
        req = MaintenanceRequest(
            tenant_name="Webhook User",
            tenant_phone="+15550105555",
            unit_number="2A",
        )
        call = CallRecord(
            call_id=unique_call_id,
            call_type="tenant_intake",
            phone="+15550105555",
            status=CallStatus.IN_PROGRESS,
        )
        req.calls.append(call)

        with TestClient(app) as client:
            requests_store[req.id] = req
            wh_res = client.post(
                "/api/webhook/calle",
                json={
                    "event_type": "call.completed",
                    "call_id": unique_call_id,
                    "status": "completed",
                    "structured_result": {"issue_type": "plumbing", "urgency": "urgent"},
                },
            )
            assert wh_res.status_code == 200
            assert wh_res.json()["status"] == "processed"
            assert wh_res.json()["request_id"] == req.id

            # Verify call record was updated
            updated_req = requests_store[req.id]
            assert updated_req.calls[0].status == CallStatus.COMPLETED
            assert updated_req.calls[0].structured_result["issue_type"] == "plumbing"



