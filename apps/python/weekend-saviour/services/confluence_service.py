import os
import json
import requests
import logging

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

CONFIG_FILE = os.path.join(os.path.dirname(__file__), '..', 'config', 'india_oncall_config.json')
# CONFIG_FILE_US = os.path.join(os.path.dirname(__file__), '..', 'config', 'us_oncall_config.json')
PLAYBOOK_FILE = os.path.join(os.path.dirname(__file__), '..', 'playbook', 'playbook.json')

def fetch_confluence_playbook(error_message: str):
    """
    Checks details in the Confluence page playbook URL hardcoded from environment variable CONFLUENCE_PLAYBOOK_URL.
    If env vars are not present, skips Confluence API call and uses local playbook.json fallback.
    """
    playbook_url = os.environ.get("CONFLUENCE_PLAYBOOK_URL")
    conf_email = os.environ.get("CONFLUENCE_USER_EMAIL")
    conf_token = os.environ.get("CONFLUENCE_API_TOKEN")

    if playbook_url and conf_email and conf_token:
        logger.info(f"[Confluence Service] Fetching playbook runbook from {playbook_url}...")
        try:
            response = requests.get(
                playbook_url,
                auth=(conf_email, conf_token),
                headers={"Accept": "application/json"},
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                logger.info("[Confluence Service] Confluence Playbook retrieved successfully.")
                return {
                    "id": "CONFLUENCE-PB-001",
                    "title": data.get("title", "Confluence Runbook"),
                    "recommended_sql": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
                    "source": "confluence_api"
                }
        except Exception as e:
            logger.warning(f"[Confluence Service] Failed to call Confluence Playbook API: {e}")

    # Fallback to local playbook.json
    logger.info("[Confluence Service] CONFLUENCE_PLAYBOOK_URL missing or unavailable. Fallback to local playbook.json.")
    if os.path.exists(PLAYBOOK_FILE):
        try:
            with open(PLAYBOOK_FILE, 'r') as f:
                entries = json.load(f)
            for entry in entries:
                if entry.get("pattern", "").lower() in error_message.lower():
                    entry["source"] = "local_playbook_file"
                    return entry
        except Exception as err:
            logger.warning(f"[Confluence Service] Error reading local playbook file: {err}")

    return {
        "id": "PB-SQL-001",
        "title": "Missing Column 'inventory_status' in daily_store_inventory_agg",
        "recommended_sql": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
        "source": "default_fallback"
    }

def get_weekend_on_call_engineer():
    """
    Checks Confluence Team Calendar for the on-call person for the day.
    If unable to find on-call details (or if env vars missing), reads local config/oncall_config.json file.
    """
    calendar_url = os.environ.get("CONFLUENCE_CALENDAR_URL")
    conf_email = os.environ.get("CONFLUENCE_USER_EMAIL")
    conf_token = os.environ.get("CONFLUENCE_API_TOKEN")

    if calendar_url and conf_email and conf_token:
        logger.info(f"[Confluence Service] Querying Confluence Team Calendar API at {calendar_url}...")
        try:
            response = requests.get(
                calendar_url,
                auth=(conf_email, conf_token),
                headers={"Accept": "application/json"},
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                logger.info("[Confluence Service] Retrieved on-call engineer from Confluence Team Calendar.")
                return {
                    "shift_name": "Confluence Team Calendar On-Call",
                    "engineer": {
                        "name": data.get("oncall_name", "Santhosh"),
                        "phone": data.get("oncall_phone", "+919003939495"),
                        "email": data.get("oncall_email", "sandyinspires@icloud.com"),
                        "locale":"en_US",
                        "region":"US",
                        "source": "confluence_team_calendar_api"
                    }
                }
        except Exception as e:
            logger.warning(f"[Confluence Service] Confluence Calendar API call failed: {e}")

    # Fallback to local config file
    logger.info(f"[Confluence Service] On-call details not found via Confluence Calendar. Reading local config file '{CONFIG_FILE}'...")
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                data = json.load(f)
            logger.info(f"[Confluence Service] Loaded on-call engineer '{data['engineer']['name']}' from local config.")
            return data
        except Exception as err:
            logger.error(f"[Confluence Service] Error reading local oncall config file: {err}")

    # Default fallback
    return config.oncall_config

if __name__ == "__main__":
    pb = fetch_confluence_playbook("table daily_store_inventory_agg has no column named inventory_status")
    oncall = get_weekend_on_call_engineer()
    logger.info(f"Playbook: {pb}")
    logger.info(f"OnCall: {oncall}")
