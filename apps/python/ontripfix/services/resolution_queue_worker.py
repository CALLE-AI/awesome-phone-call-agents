import queue
import threading
import time
import logging
from services.langgraph_remediation import run_langgraph_remediation
from services.calle_voice_service import CallEVoiceService
from services.jira_service import add_jira_comment, update_jira_ticket_status


logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
    )

resolution_queue = queue.Queue()
calle_service = CallEVoiceService()

from db.telemetry_db import (
    log_incident_update,
    log_queue_action,
    log_service_event,
    log_step,
)


def enqueue_resolution(payload: dict):
    """Pushes an engineer's resolution response onto the Resolution Queue."""
    incident_id = payload.get("incident_id", "UNKNOWN")
    log_queue_action("RESOLUTION_QUEUE", incident_id, "ENQUEUED", payload)
    log_step(
        incident_id,
        4,
        "Resolution Queue Enqueued",
        "SUCCESS",
        f"Approved instructions received: '{payload.get('resolution_instructions')}'",
    )
    logger.info(
        f"📥 [Resolution Queue] Enqueued resolution instructions for Incident '{incident_id}'."
    )
    resolution_queue.put(payload)


def process_resolution_queue():
    """Worker loop to process resolutions from the Resolution Queue via LangGraph."""
    while True:
        try:
            payload = resolution_queue.get(timeout=1)
        except queue.Empty:
            time.sleep(0.5)
            continue

        incident_id = payload.get("incident_id")
        instructions = payload.get("resolution_instructions", "")
        dag_id = payload.get("dag_id", "retail_inventory_etl")
        task_id = payload.get("task_id", "transform_inventory_sql")
        result_schema = payload.get("result_schema", {})
        oncall_engineer = result_schema.get(
            "oncall_engineer", {"name": "Alex Morgan", "phone": "+1-555-0199"}
        )
        jira_key = (result_schema.get("error_context") or {}).get(
            "jira_ticket", {}
        ).get("key") or payload.get("jira_ticket_key")

        log_queue_action("RESOLUTION_QUEUE", incident_id, "DEQUEUED", payload)
        log_incident_update(incident_id, {"status": "REMEDIATING"})

        logger.info("\n" + "=" * 75)
        logger.info(
            f"⚙️ [Resolution Queue Worker] Processing Resolution for Incident '{incident_id}' via LangGraph..."
        )
        logger.info("=" * 75)

        if jira_key:
            add_jira_comment(
                jira_key,
                f"⚡ Starting LangGraph StateGraph & Gemini Tools SQL remediation patch execution for DAG '{dag_id}' (Task: '{task_id}'). Approved instructions: `{instructions}`",
            )

        log_service_event(
            incident_id,
            "LANGGRAPH",
            "LANGGRAPH_EXECUTION_START",
            "INFO",
            f"Executing LangGraph StateGraph (Gemini tools) for instructions: '{instructions}'",
        )

        # 1. Run LangGraph StateGraph & Gemini Tools
        val_result = run_langgraph_remediation(
            instructions=instructions, dag_id=dag_id, task_id=task_id
        )

        is_success = val_result.get("success", False)

        log_step(
            incident_id,
            5,
            "LangGraph StateGraph & SQL Patch Execution",
            "SUCCESS" if is_success else "FAILED",
            f"SQL patch executed. Validation: {val_result.get('message')}",
        )

        # 2. Call-E Follow-up Call or Zoom Bridge Failover
        if is_success:
            logger.info(
                f"✅ [Resolution Worker] Remediation & Validation SUCCESSFUL for '{incident_id}'!"
            )
            log_incident_update(incident_id, {"status": "RESOLVED"})
            log_service_event(
                incident_id,
                "LANGGRAPH",
                "REMEDIATION_SUCCESS",
                "SUCCESS",
                f"Validation successful: {val_result.get('records_processed')} records aggregated.",
                {"val_result": val_result},
            )
            log_step(
                incident_id,
                6,
                "Call-E Post-Validation Follow-up Call",
                "SUCCESS",
                f"Placed confirmation voice call to {oncall_engineer.get('name')}. Operational status: GREEN",
            )
            if jira_key:
                update_jira_ticket_status(jira_key, "Done")
                add_jira_comment(
                    jira_key,
                    f"🎉 Remediation & Validation SUCCESSFUL! Applied DDL patch to database. Processed {val_result.get('records_processed')} records. Airflow DAG re-run verified. Jira ticket status transitioned to DONE.",
                )

            calle_service.call_post_validation(
                engineer_info=oncall_engineer,
                dag_id=dag_id,
                task_id=task_id,
                success=True,
            )
        else:
            zoom_url = "https://zoom.us/j/9876543210?pwd=INCIDENT_BRIDGE"
            logger.error(
                f"❌ [Resolution Worker] Remediation FAILED for '{incident_id}'. Initiating Zoom Bridge Failover: {zoom_url}"
            )
            log_incident_update(incident_id, {"status": "FAILED"})
            log_service_event(
                incident_id,
                "LANGGRAPH",
                "REMEDIATION_FAILURE",
                "ERROR",
                f"Validation failed. Triggering Zoom emergency bridge: {zoom_url}",
                {"val_result": val_result},
            )
            log_step(
                incident_id,
                6,
                "Emergency Zoom Bridge Alert Call",
                "FAILED",
                f"Placed emergency alert voice call to {oncall_engineer.get('name')}. Zoom URL: {zoom_url}",
            )
            if jira_key:
                add_jira_comment(
                    jira_key,
                    f"❌ Remediation FAILED: {val_result.get('message')}. Emergency Zoom Bridge triggered: {zoom_url}",
                )
            calle_service.call_post_validation(
                engineer_info=oncall_engineer,
                dag_id=dag_id,
                task_id=task_id,
                success=False,
                zoom_bridge_url=zoom_url,
            )

        log_queue_action("RESOLUTION_QUEUE", incident_id, "PROCESSED", payload)
        resolution_queue.task_done()
