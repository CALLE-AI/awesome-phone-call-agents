"""FastAPI application for SmartRent Maintenance Coordinator.

Provides REST endpoints for creating maintenance requests,
triggering workflows, and serving the dashboard.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.calle_client import CalleService
from app.config import get_config
from app.db import init_db, list_requests as db_list_requests, save_request
from app.models import (
    CallStatus,
    CreateRequestPayload,
    DashboardData,
    MaintenanceRequest,
    RequestSummary,
    WorkflowState,
)
from app.workflows import MaintenanceWorkflow

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ─── In-memory store ─────────────────────────────────────────────────────────

requests_store: dict[str, MaintenanceRequest] = {}


# ─── App lifecycle ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    app.state.config = config
    app.state.calle_service = CalleService(config.calle)
    app.state.workflow = MaintenanceWorkflow(app.state.calle_service)

    # Initialize SQLite database and restore any previously saved requests
    init_db()
    for persisted_req in db_list_requests():
        requests_store[persisted_req.id] = persisted_req
    logger.info(f"Loaded {len(requests_store)} maintenance requests from SQLite persistence")

    mode = "DRY-RUN" if config.calle.dry_run else "LIVE"
    logger.info(f"SmartRent Maintenance Coordinator started in {mode} mode")
    logger.info(f"Dashboard: http://localhost:{config.port}")
    yield
    logger.info("SmartRent shutting down")


# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="SmartRent Maintenance Coordinator",
    description="AI-powered property maintenance coordination using CALL-E phone calls",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ─── API Endpoints ───────────────────────────────────────────────────────────

@app.get("/")
async def serve_dashboard():
    """Serve the dashboard SPA."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "SmartRent Maintenance Coordinator API", "docs": "/docs"}


@app.get("/style.css")
async def serve_css():
    return FileResponse(FRONTEND_DIR / "style.css", media_type="text/css")


@app.get("/app.js")
async def serve_js():
    return FileResponse(FRONTEND_DIR / "app.js", media_type="application/javascript")


@app.post("/api/requests", response_model=MaintenanceRequest)
async def create_request(payload: CreateRequestPayload, background_tasks: BackgroundTasks):
    """Create a new maintenance request and start the workflow."""
    req = MaintenanceRequest(
        tenant_name=payload.tenant_name,
        tenant_phone=payload.tenant_phone,
        unit_number=payload.unit_number,
        property_name=payload.property_name,
        initial_description=payload.initial_description,
        simulate_cascade=payload.simulate_cascade,
    )
    req.add_timeline_event("request_created", f"Maintenance request created for Unit {req.unit_number}")
    requests_store[req.id] = req
    save_request(req)

    logger.info(f"Created maintenance request {req.id} for {req.tenant_name} (Unit {req.unit_number})")

    # Run the full workflow in the background
    background_tasks.add_task(run_workflow_background, req.id)

    return req


@app.get("/api/requests", response_model=list[RequestSummary])
async def list_requests():
    """List all maintenance requests."""
    summaries = []
    for req in sorted(requests_store.values(), key=lambda r: r.created_at, reverse=True):
        summaries.append(RequestSummary(
            id=req.id,
            tenant_name=req.tenant_name,
            unit_number=req.unit_number,
            state=req.state,
            issue_type=req.issue_type,
            urgency=req.urgency,
            assigned_vendor=req.assigned_vendor.name if req.assigned_vendor else None,
            vendor_eta=req.vendor_eta,
            created_at=req.created_at,
            updated_at=req.updated_at,
            call_count=len(req.calls),
        ))
    return summaries


@app.get("/api/requests/{request_id}", response_model=MaintenanceRequest)
async def get_request(request_id: str):
    """Get full details of a maintenance request."""
    req = requests_store.get(request_id)
    if not req:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")
    return req


@app.post("/api/requests/{request_id}/step/{step}")
async def trigger_step(request_id: str, step: str, background_tasks: BackgroundTasks):
    """Manually trigger a specific workflow step."""
    req = requests_store.get(request_id)
    if not req:
        raise HTTPException(status_code=404, detail=f"Request {request_id} not found")

    workflow: MaintenanceWorkflow = app.state.workflow

    if step == "tenant_intake":
        background_tasks.add_task(run_step, workflow.step_tenant_intake, req)
    elif step == "vendor_dispatch":
        background_tasks.add_task(run_step, workflow.step_vendor_dispatch, req)
    elif step == "tenant_confirm":
        background_tasks.add_task(run_step, workflow.step_tenant_confirm, req)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown step: {step}")

    return {"message": f"Step '{step}' triggered for {request_id}"}


@app.get("/api/dashboard")
async def get_dashboard_data():
    """Get aggregated dashboard data."""
    all_reqs = list(requests_store.values())
    total_calls = sum(len(r.calls) for r in all_reqs)

    summaries = []
    for req in sorted(all_reqs, key=lambda r: r.created_at, reverse=True):
        summaries.append(RequestSummary(
            id=req.id,
            tenant_name=req.tenant_name,
            unit_number=req.unit_number,
            state=req.state,
            issue_type=req.issue_type,
            urgency=req.urgency,
            assigned_vendor=req.assigned_vendor.name if req.assigned_vendor else None,
            vendor_eta=req.vendor_eta,
            created_at=req.created_at,
            updated_at=req.updated_at,
            call_count=len(req.calls),
        ))

    return DashboardData(
        total_requests=len(all_reqs),
        active_requests=len([r for r in all_reqs if r.state not in (WorkflowState.COMPLETED, WorkflowState.FAILED)]),
        completed_requests=len([r for r in all_reqs if r.state == WorkflowState.COMPLETED]),
        failed_requests=len([r for r in all_reqs if r.state == WorkflowState.FAILED]),
        total_calls=total_calls,
        requests=summaries,
    )


@app.post("/api/webhook/calle")
async def calle_webhook(request: Request):
    """Handle CALL-E webhook events and update matching call records."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = body.get("event_type") or body.get("type", "call_updated")
    call_id = body.get("call_id") or body.get("id")
    status = body.get("status")

    logger.info(f"CALL-E webhook received: event={event_type}, call_id={call_id}, status={status}")

    if not call_id:
        return {"status": "ignored", "reason": "No call_id provided"}

    matched_req = None
    for req in list(requests_store.values()):
        for call in req.calls:
            if call.call_id == call_id:
                matched_req = req
                if status:
                    try:
                        call.status = CallStatus(status)
                    except ValueError:
                        pass
                if "structured_result" in body:
                    call.structured_result = body["structured_result"]
                if "evidence" in body:
                    call.evidence = body["evidence"]
                if "recording_url" in body:
                    call.recording_url = body["recording_url"]
                elif "audio_url" in body:
                    call.recording_url = body["audio_url"]
                req.add_timeline_event(
                    "webhook_update",
                    f"CALL-E webhook callback: Call {call_id} updated to {status or 'completed'}"
                )
                save_request(req)
                break
        if matched_req:
            break

    if matched_req:
        return {"status": "processed", "request_id": matched_req.id, "call_id": call_id}
    return {"status": "ok", "message": "No matching local request for call_id"}


@app.get("/api/config")
async def get_app_config():
    """Get public app configuration."""
    config = app.state.config
    return {
        "dry_run": config.calle.dry_run,
        "has_api_key": bool(config.calle.api_key),
    }


# ─── Background task runners ─────────────────────────────────────────────────

async def run_workflow_background(request_id: str):
    """Run the full workflow for a request."""
    req = requests_store.get(request_id)
    if not req:
        return

    workflow: MaintenanceWorkflow = app.state.workflow

    # Add small delays between steps for realistic UX
    await asyncio.sleep(1)
    req = await workflow.step_tenant_intake(req)
    requests_store[request_id] = req
    save_request(req)

    if req.state == WorkflowState.FAILED:
        return

    await asyncio.sleep(1)
    req = await workflow.step_vendor_dispatch(req)
    requests_store[request_id] = req
    save_request(req)

    if req.state == WorkflowState.FAILED:
        return

    await asyncio.sleep(1)
    req = await workflow.step_tenant_confirm(req)
    requests_store[request_id] = req
    save_request(req)


async def run_step(step_fn, req: MaintenanceRequest):
    """Run a single workflow step."""
    result = await step_fn(req)
    requests_store[result.id] = result
    save_request(result)


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    config = get_config()
    uvicorn.run("app.main:app", host=config.host, port=config.port, reload=True)
