import queue
import threading
import time
import uuid
import datetime
import logging
from services.jira_service import search_jira
from services.confluence_service import fetch_confluence_playbook, get_weekend_on_call_engineer
from services.calle_voice_service import CallEVoiceService

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

error_queue = queue.Queue()
calle_service = CallEVoiceService()

def enqueue_error_payload(payload: dict):
    """Pushes a DAG failure payload onto the Error Queue."""
    incident_id = f"INC-{uuid.uuid4().hex[:6].upper()}"
    payload["incident_id"] = incident_id
    logger.info(f"📥 [Error Queue] Enqueued incident '{incident_id}' for DAG '{payload.get('dag_id')}'.")
    error_queue.put(payload)
    return incident_id

def process_error_queue(resolution_queue_push_func):
    """Worker loop to process incidents from the Error Queue."""
    while True:
        try:
            payload = error_queue.get(timeout=1)
        except queue.Empty:
            time.sleep(0.5)
            continue

        incident_id = payload.get("incident_id")
        logger.info("\n" + "="*75)
        logger.info(f"⚙️ [Error Queue Worker] Processing Incident '{incident_id}'...")
        logger.info("="*75)

        error_msg = payload.get("error_message", "")

        # 1. Search Jira API (or env check fallback)
        jira_history = search_jira(error_msg)

        # 2. Search Confluence Playbook URL (or env check fallback)
        playbook = fetch_confluence_playbook(error_msg)

        # 3. Get On-Call Engineer from Confluence Calendar (or local config fallback)
        oncall_data = get_weekend_on_call_engineer()

        # Format standardized resultSchema
        result_schema = {
            "incident_id": incident_id,
            "created_at": datetime.datetime.now().isoformat(),
            "error_context": payload,
            "jira_history": jira_history,
            "playbook_details": playbook,
            "oncall_engineer": oncall_data["engineer"],
            "shift_info": oncall_data.get("shift_name", "Weekend On-Call Shift")
        }

        logger.info(f"📋 [Error Queue Worker] Formatted resultSchema for '{incident_id}':")
        logger.info(f"   On-Call Engineer: {result_schema['oncall_engineer']['name']} ({result_schema['oncall_engineer']['phone']})")
        logger.info(f"   Source Roster: {result_schema['oncall_engineer']['source']}")
        logger.info(f"   Jira History: {len(result_schema['jira_history'])} ticket(s)")
        logger.info(f"   Playbook Match: {result_schema['playbook_details']['title']}")

        # 4. Initiate Call-E Outbound Call to On-Call Engineer
        resolution_response = calle_service.call_on_call_engineer(result_schema)
        resolution_response["result_schema"] = result_schema

        # 5. Push resolution payload to Resolution Queue
        resolution_queue_push_func(resolution_response)

        error_queue.task_done()
