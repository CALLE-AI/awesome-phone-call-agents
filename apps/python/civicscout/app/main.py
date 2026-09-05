import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.models import (
    CivicTicket,
    TicketStatus,
    DepartmentEnum,
    TicketSeverity,
    CalleWebhookPayload,
    AuthorizationQueryRequest,
    MidCallStatusUpdateRequest,
    EscalationTriggerRequest,
)
from app.database import db
from app.orchestrator import orchestrator
from app.calle_client import calle_client
from app.mcp_server import (
    mcp,
    query_authorization_code,
    update_ticket_status_midcall,
    trigger_department_escalation,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("CivicScout.Main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing CivicScout Public Works Voice Orchestration System...")
    logger.info("Environment: %s | GCP Project: %s | Firestore Mock: %s", settings.ENVIRONMENT, settings.GCP_PROJECT_ID, db.use_mock)
    yield
    logger.info("Shutting down CivicScout System.")


# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Proactive Public Works Voice Agent with CALL-E, FastMCP, Google Cloud Run, and Firestore",
    lifespan=lifespan,
)

# Add CORS Middleware for dashboard / web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount FastMCP HTTP/SSE Server
try:
    mcp_subapp = mcp.http_app()
    app.mount("/mcp", mcp_subapp)
    logger.info("FastMCP mounted at /mcp")
except Exception as e:
    logger.warning("Could not mount FastMCP subapp directly (%s). Direct tool routes available.", e)


import os
from fastapi.responses import HTMLResponse, FileResponse

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

@app.get("/", response_class=HTMLResponse)
async def root():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return "<h1>CivicScout Voice Agent Operational</h1>"


@app.get("/api/status")
async def system_status():
    tickets = await db.list_tickets()
    pending = [t for t in tickets if t.status == TicketStatus.PENDING_OUTREACH]
    escalated = [t for t in tickets if t.status == TicketStatus.ESCALATED]
    dispatched = [t for t in tickets if t.status == TicketStatus.FIELD_DISPATCHED]

    return {
        "system": "CivicScout",
        "description": "Proactive Public Works Autonomous Voice Agent",
        "version": settings.APP_VERSION,
        "status": "OPERATIONAL",
        "cloud_run_ready": True,
        "telemetry": {
            "total_tickets": len(tickets),
            "pending_outreach": len(pending),
            "escalated_to_emergency": len(escalated),
            "field_dispatched": len(dispatched),
        },
        "docs_url": "/docs",
        "mcp_endpoint": "/mcp",
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "mock_firestore" if db.use_mock else "cloud_firestore",
        "gcp_project": settings.GCP_PROJECT_ID,
        "calle_api_configured": bool(settings.CALLE_API_KEY),
        "fastmcp_server": settings.MCP_SERVER_NAME,
    }


# ==========================================
# 311 Civic Ticket Management Endpoints
# ==========================================

@app.get("/api/tickets", response_model=List[CivicTicket])
async def list_tickets(
    status: Optional[TicketStatus] = None,
    department: Optional[DepartmentEnum] = None
):
    """Retrieve all municipal civic tickets with optional status/department filters."""
    return await db.list_tickets(status=status, department=department)


@app.get("/api/tickets/{ticket_id}", response_model=CivicTicket)
async def get_ticket(ticket_id: str):
    """Retrieve a single civic ticket by ID."""
    ticket = await db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket '{ticket_id}' not found.")
    return ticket


@app.post("/api/tickets", response_model=CivicTicket, status_code=201)
async def create_ticket(ticket: CivicTicket):
    """Ingest a new 311 civic ticket."""
    existing = await db.get_ticket(ticket.id)
    if existing:
        raise HTTPException(status_code=409, detail=f"Ticket with ID '{ticket.id}' already exists.")
    created = await db.save_ticket(ticket)
    logger.info("Created new 311 ticket: %s - %s", created.id, created.title)
    return created


# ==========================================
# CALL-E Outbound Dispatch & Orchestration
# ==========================================

@app.post("/api/tickets/{ticket_id}/dispatch")
async def dispatch_ticket_call(ticket_id: str):
    """Trigger a CALL-E outbound call to the citizen/reporter for the specified ticket."""
    result = await orchestrator.dispatch_single_ticket(ticket_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error"))
    return result


@app.post("/api/orchestrator/poll")
async def poll_orchestrator(background_tasks: BackgroundTasks):
    """Scan Firestore for all PENDING_OUTREACH tickets and trigger CALL-E outbound dispatch."""
    results = await orchestrator.poll_and_dispatch_pending()
    return {
        "status": "success",
        "message": f"Processed {results['count']} pending ticket(s).",
        "results": results
    }


@app.post("/api/tickets/{ticket_id}/simulate-call")
async def simulate_call_lifecycle(
    ticket_id: str,
    simulate_escalation: bool = Query(default=True, description="Whether to simulate a hazardous scenario requiring escalation")
):
    """
    Simulate full CALL-E execution lifecycle for a ticket:
    1. Triggers outbound call
    2. Executes mid-call FastMCP tools (auth verification & status updates)
    3. Returns structured JSON output
    4. Triggers orchestrator webhook and secondary agent escalation if requested
    """
    ticket = await db.get_ticket(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket '{ticket_id}' not found.")

    # 1. Update ticket to CALL_IN_PROGRESS
    await db.update_ticket_status(ticket_id, TicketStatus.CALL_IN_PROGRESS, notes="Simulated CALL-E voice dial started.")

    # 2. Simulate mid-call FastMCP tool call
    if ticket.authorization_code:
        await query_authorization_code(ticket_id=ticket.id, auth_code=ticket.authorization_code)

    # 3. Generate completed CALL-E simulation payload
    simulated_payload_dict = calle_client.simulate_call_execution(
        ticket=ticket,
        call_id=f"sim_call_{ticket.id.lower().replace('-', '_')}",
        simulate_escalation=simulate_escalation
    )

    # 4. Deliver to webhook handler
    webhook_payload = CalleWebhookPayload.model_validate(simulated_payload_dict)
    webhook_result = await orchestrator.handle_call_webhook(webhook_payload)

    updated_ticket = await db.get_ticket(ticket_id)
    return {
        "simulation_status": "SUCCESS",
        "ticket_id": ticket_id,
        "escalation_triggered": simulate_escalation,
        "webhook_result": webhook_result,
        "final_ticket": updated_ticket,
    }


# ==========================================
# CALL-E Webhook Ingestion
# ==========================================

@app.post("/api/webhooks/calle")
async def calle_webhook(payload: CalleWebhookPayload):
    """
    Webhook receiver invoked by the CALL-E platform when a call starts, completes, or returns structured data.
    """
    logger.info("Received CALL-E Webhook: event=%s call_id=%s", payload.event_type, payload.call_id)
    result = await orchestrator.handle_call_webhook(payload)
    return result


# ==========================================
# Direct REST Endpoints for FastMCP Tools
# ==========================================

@app.post("/api/mcp/tools/query-auth")
async def mcp_tool_query_auth(body: AuthorizationQueryRequest):
    """Direct HTTP invocation endpoint for FastMCP tool 'query_authorization_code'."""
    return await query_authorization_code(ticket_id=body.ticket_id, auth_code=body.auth_code)


@app.post("/api/mcp/tools/update-status")
async def mcp_tool_update_status(body: MidCallStatusUpdateRequest):
    """Direct HTTP invocation endpoint for FastMCP tool 'update_ticket_status_midcall'."""
    return await update_ticket_status_midcall(
        ticket_id=body.ticket_id,
        status=body.status.value,
        notes=body.notes,
        severity=body.severity.value if body.severity else None
    )


@app.post("/api/mcp/tools/escalate")
async def mcp_tool_escalate(body: EscalationTriggerRequest):
    """Direct HTTP invocation endpoint for FastMCP tool 'trigger_department_escalation'."""
    return await trigger_department_escalation(
        ticket_id=body.ticket_id,
        source_dept=body.source_department.value,
        target_dept=body.target_department.value,
        reason=body.reason,
        urgency_level=body.urgency_level.value
    )
