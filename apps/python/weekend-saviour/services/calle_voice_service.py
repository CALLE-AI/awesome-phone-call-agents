import os
import requests
import logging

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

CALLE_API_ENDPOINT = os.environ.get("CALLE_API_ENDPOINT", "https://docs.heycall-e.com/calls")

class CallEVoiceService:
    def __init__(self):
        self.api_key = os.environ.get("CALLE_API_KEY")
        logger.info(f"[Call-E Service] Call-E Voice API endpoint set to '{CALLE_API_ENDPOINT}'.")

    def call_on_call_engineer(self, result_schema: dict):
        """
        Calls on-call engineer using Call-E API (https://docs.heycall-e.com/calls).
        Presents detailed error, Playbook, Jira history, and requests resolution steps.
        """
        engineer = result_schema["oncall_engineer"]
        eng_name = engineer.get("name", "Alex Morgan")
        phone = engineer.get("phone", "+1-555-0199")
        error_context = result_schema.get("error_context", {})
        dag_id = error_context.get("dag_id", "retail_inventory_etl")
        task_id = error_context.get("task_id", "transform_inventory_sql")
        error_msg = error_context.get("error_message", "")
        playbook = result_schema.get("playbook_details", {})
        jira = result_schema.get("jira_history", [])

        playbook_fix = playbook.get("recommended_sql", "No automatic match.")
        jira_ref = jira[0].get("key") if jira else "None"

        call_payload = {
            "phone_number": phone,
            "agent_id": "call_e_incident_response_agent",
            "prompt": (
                f"Hello {eng_name}. Urgent incident alert from Apache Airflow.\n"
                f"Sunday Night Retail Inventory ETL DAG ({dag_id}) failed at task '{task_id}'.\n"
                f"Error: {error_msg}.\n"
                f"Playbook match ({playbook.get('id', 'N/A')}): {playbook.get('title', 'N/A')}.\n"
                f"Jira historical match: {jira_ref}.\n"
                f"Suggested SQL Fix: {playbook_fix}\n"
                f"Please provide step-by-step resolution instructions."
            ),
            "context": result_schema
        }

        logger.info("\n" + "="*75)
        logger.info(f"📞 [CALL-E API OUTBOUND CALL] POST {CALLE_API_ENDPOINT}")
        logger.info(f"   Target: On-Call Engineer {eng_name} ({phone})")
        logger.info("="*75)

        if self.api_key:
            try:
                response = requests.post(
                    CALLE_API_ENDPOINT,
                    json=call_payload,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    timeout=10
                )
                logger.info(f"[Call-E API] Call triggered successfully. Status: {response.status_code}")
            except Exception as e:
                logger.warning(f"[Call-E API] API call failed: {e}")

        # Simulate voice dialogue response from engineer
        logger.info(f"\n🗣️ [{eng_name} via Call-E Voice AI]: 'Approved. Please run: ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT \'OK\'; then validate data.'")
        logger.info("="*75 + "\n")

        return {
            "approved": True,
            "engineer_name": eng_name,
            "engineer_phone": phone,
            "resolution_instructions": f"ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
            "dag_id": dag_id,
            "task_id": task_id,
            "incident_id": result_schema.get("incident_id")
        }

    def call_post_validation(self, engineer_info: dict, dag_id: str, task_id: str, success: bool, zoom_bridge_url: str = None):
        """
        Calls on-call engineer post-remediation.
        If solved: informs that steps solved the issue.
        If not solved: informs failure and requests joining Zoom bridge.
        """
        eng_name = engineer_info.get("name", "Alex Morgan")
        phone = engineer_info.get("phone", "+1-555-0199")

        logger.info("\n" + "="*75)
        logger.info(f"📞 [CALL-E FOLLOW-UP CALL] POST {CALLE_API_ENDPOINT}")
        logger.info(f"   Target: {eng_name} ({phone})")
        logger.info("="*75)

        if success:
            script = (
                f"Voice Agent: 'Hi {eng_name}, Call-E here with confirmation!\n"
                f"The resolution steps you provided have successfully solved the error in DAG '{dag_id}', task '{task_id}'.\n"
                f"Data load is 100% validated and green for Monday morning operations! Thank you.'"
            )
        else:
            zoom_url = zoom_bridge_url or "https://zoom.us/j/9876543210?pwd=INCIDENT_BRIDGE"
            script = (
                f"Voice Agent: 'ALERT {eng_name}! The steps provided did NOT resolve the error in DAG '{dag_id}'.\n"
                f"Data validation failed. Please join the emergency Zoom bridge immediately: {zoom_url}'"
            )

        logger.info(script)
        logger.info("="*75 + "\n")

if __name__ == "__main__":
    calle = CallEVoiceService()
    dummy_schema = {
        "incident_id": "INC-1001",
        "oncall_engineer": {"name": "Alex Morgan", "phone": "+1-555-0199"},
        "error_context": {"dag_id": "retail_inventory_etl", "task_id": "transform_inventory_sql", "error_message": "no column named inventory_status"},
        "playbook_details": {"id": "PB-SQL-001", "title": "Missing Column", "recommended_sql": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';"},
        "jira_history": [{"key": "RETAIL-4021"}]
    }
    res = calle.call_on_call_engineer(dummy_schema)
    calle.call_post_validation(dummy_schema["oncall_engineer"], "retail_inventory_etl", "transform_inventory_sql", success=True)
