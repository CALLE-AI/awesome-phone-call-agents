import queue
import threading
import time
import logging
from services.langgraph_remediation import run_langgraph_remediation
from services.calle_voice_service import CallEVoiceService

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

resolution_queue = queue.Queue()
calle_service = CallEVoiceService()

def enqueue_resolution(payload: dict):
    """Pushes an engineer's resolution response onto the Resolution Queue."""
    incident_id = payload.get("incident_id", "UNKNOWN")
    logger.info(f"📥 [Resolution Queue] Enqueued resolution instructions for Incident '{incident_id}'.")
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
        oncall_engineer = result_schema.get("oncall_engineer", {"name": "Alex Morgan", "phone": "+1-555-0199"})

        logger.info("\n" + "="*75)
        logger.info(f"⚙️ [Resolution Queue Worker] Processing Resolution for Incident '{incident_id}' via LangGraph...")
        logger.info("="*75)

        # 1. Run LangGraph StateGraph & Gemini Tools
        val_result = run_langgraph_remediation(
            instructions=instructions,
            dag_id=dag_id,
            task_id=task_id
        )

        is_success = val_result.get("success", False)

        # 2. Call-E Follow-up Call or Zoom Bridge Failover
        if is_success:
            logger.info(f"✅ [Resolution Worker] Remediation & Validation SUCCESSFUL for '{incident_id}'!")
            calle_service.call_post_validation(
                engineer_info=oncall_engineer,
                dag_id=dag_id,
                task_id=task_id,
                success=True
            )
        else:
            zoom_url = "https://zoom.us/j/9876543210?pwd=INCIDENT_BRIDGE"
            logger.error(f"❌ [Resolution Worker] Remediation FAILED for '{incident_id}'. Initiating Zoom Bridge Failover: {zoom_url}")
            calle_service.call_post_validation(
                engineer_info=oncall_engineer,
                dag_id=dag_id,
                task_id=task_id,
                success=False,
                zoom_bridge_url=zoom_url
            )

        resolution_queue.task_done()
