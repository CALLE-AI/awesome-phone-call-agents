import os
import sys
import threading
import logging
from logging.handlers import RotatingFileHandler
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Add parent directory to python path for service imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Configure Rolling File Logging (console + rolling log file)
LOG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "logs"))
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE_PATH = os.path.join(LOG_DIR, "fastapi_app.log")

log_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Console Handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.INFO)

# Rolling File Handler (10MB per file, 5 backup files)
file_handler = RotatingFileHandler(
    LOG_FILE_PATH, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)

# Configure Root, Airflow, and Uvicorn loggers (avoiding duplicate handler propagation)
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers = [console_handler, file_handler]

airflow_logger = logging.getLogger("airflow.task")
airflow_logger.setLevel(logging.INFO)
airflow_logger.handlers = []
airflow_logger.propagate = True

for uv_name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
    uv_log = logging.getLogger(uv_name)
    uv_log.setLevel(logging.INFO)
    uv_log.handlers = []
    uv_log.propagate = True


from services.error_queue_worker import enqueue_error_payload, process_error_queue
from services.resolution_queue_worker import (
    enqueue_resolution,
    process_resolution_queue,
)
from services.confluence_service import get_weekend_on_call_engineer
from db.telemetry_db import (
    init_telemetry_db,
    get_dashboard_stats,
    get_all_incidents,
    get_incident_details,
    get_queue_messages,
    get_audit_logs,
)



# Background queue workers initialization
def start_background_workers():
    init_telemetry_db()
    error_thread = threading.Thread(
        target=process_error_queue, args=(enqueue_resolution,), daemon=True
    )
    error_thread.start()

    resolution_thread = threading.Thread(target=process_resolution_queue, daemon=True)
    resolution_thread.start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Launch background queue workers
    start_background_workers()
    yield
    # Shutdown logic if needed


app = FastAPI(
    title="OnTripFix - Autonomous Incident Remediation API",
    description="FastAPI service for Airflow incident interception, Call-E Voice AI calls, and LangGraph auto-remediation.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Enable CORS for browser dashboard interactions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AirflowWebhookPayload(BaseModel):
    dag_id: str = Field(
        default="retail_inventory_etl", description="ID of the failed Airflow DAG"
    )
    task_id: str = Field(
        default="transform_inventory_sql", description="ID of the failed Airflow Task"
    )
    execution_date: Optional[str] = Field(
        default=None, description="Execution date ISO timestamp"
    )
    error_message: str = Field(..., description="Exception or error message string")
    exception: Optional[str] = Field(
        default=None, description="Full traceback or exception string"
    )


@app.get("/api/health", summary="Service Health Check")
def health_check():
    """Returns the operational status of the OnTripFix FastAPI server and background queue workers."""
    return {
        "status": "ONLINE",
        "service": "OnTripFix - Autonomous Incident Remediation Server",
        "framework": "FastAPI (v0.141+)",
        "error_queue": "RUNNING",
        "resolution_queue": "RUNNING",
        "telemetry_db": "ONLINE",
    }


@app.post(
    "/api/airflow-failure-webhook",
    status_code=202,
    summary="Airflow Failure Webhook Interceptor",
)
def airflow_failure_webhook(payload: AirflowWebhookPayload):
    """
    FastAPI HTTP Webhook Endpoint for Airflow `on_failure_callback`.
    Intercepts DAG failure telemetry, enqueues to Error Queue, and returns incident ID immediately.
    """
    payload_dict = payload.model_dump()
    incident_id = enqueue_error_payload(payload_dict)

    return {
        "status": "QUEUED",
        "incident_id": incident_id,
        "dag_id": payload.dag_id,
        "task_id": payload.task_id,
        "message": "Incident payload enqueued onto Error Queue for processing.",
    }


@app.get("/api/dashboard/stats", summary="Get Dashboard KPI Metrics")
def dashboard_stats():
    """Returns aggregate metrics, queue counts, and recent incidents for the React Dashboard."""
    stats = get_dashboard_stats()
    oncall = get_weekend_on_call_engineer()
    stats["oncall_engineer"] = oncall.get("engineer", {})
    stats["shift_name"] = oncall.get("shift_name", "Weekend On-Call Shift")
    return stats


@app.get("/api/incidents", summary="List All Incidents")
def list_incidents():
    """Lists all incidents recorded in the telemetry database."""
    return get_all_incidents()


@app.get("/api/incidents/{incident_id}", summary="Get Incident Timeline Details")
def incident_details(incident_id: str):
    """Retrieves step-by-step progress timeline (1 to 6) and service logs for a specific incident."""
    details = get_incident_details(incident_id)
    if not details:
        raise HTTPException(
            status_code=404, detail=f"Incident '{incident_id}' not found."
        )
    return details


@app.get("/api/queues", summary="Inspect Queue Messages")
def inspect_queues():
    """Returns received and pending messages for both Error Queue and Resolution Queue."""
    return get_queue_messages()


@app.get("/api/logs", summary="Get Audit Logs")
def audit_logs(limit: int = 60):
    """Returns timestamped audit logs across all microservices (Airflow, FastAPI, Jira, Confluence, Call-E, LangGraph)."""
    return get_audit_logs(limit=limit)


@app.get("/api/roster", summary="Get Active On-Call Roster")
def get_roster():
    """Returns active on-call engineer roster configuration."""
    return get_weekend_on_call_engineer()


@app.post(
    "/api/simulation/trigger", status_code=202, summary="Trigger Simulation Incident"
)
def trigger_simulation(background_tasks: BackgroundTasks):
    """Allows one-click incident simulation directly from the React Dashboard."""
    test_payload = {
        "dag_id": "retail_inventory_etl",
        "task_id": "transform_inventory_sql",
        "execution_date": "2026-09-06T22:00:00",
        "error_message": "sqlite3.OperationalError: table daily_store_inventory_agg has no column named inventory_status",
    }
    incident_id = enqueue_error_payload(test_payload)
    return {
        "status": "SIMULATION_TRIGGERED",
        "incident_id": incident_id,
        "message": "Test incident triggered and enqueued onto Error Queue.",
    }


from fastapi.staticfiles import StaticFiles

UI_DIST_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
)
UI_ASSETS_DIR = os.path.join(UI_DIST_DIR, "assets")

if os.path.exists(UI_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=UI_ASSETS_DIR), name="assets")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def serve_dashboard():
    """Serves the OnTripFix React Application Dashboard."""
    index_path = os.path.join(UI_DIST_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    fallback_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "dashboard", "index.html")
    )
    if os.path.exists(fallback_path):
        with open(fallback_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>OnTripFix API</h1><p>Visit <a href='/docs'>/docs</a> for Swagger UI.</p>"


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 7071))
    print(f"🚀 Starting OnTripFix FastAPI Server on http://0.0.0.0:{port}")
    print(f"📚 Swagger Interactive API Documentation: http://localhost:{port}/docs")
    print(f"📝 Logs written to console and rolling file: {LOG_FILE_PATH}")
    uvicorn.run("fastapi_app.app:app", host="0.0.0.0", port=port, reload=False, log_config=None)


