import os
import sys
import pytest
import sqlite3

# Add root directory to python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from db.init_sqlite import init_db, DB_PATH
from services.jira_service import search_jira
from services.confluence_service import fetch_confluence_playbook, get_weekend_on_call_engineer
from services.calle_voice_service import CallEVoiceService
from services.langgraph_remediation import run_langgraph_remediation
from services.error_queue_worker import enqueue_error_payload
from services.resolution_queue_worker import enqueue_resolution

def test_database_initialization():
    init_db(reset_schema=True)
    assert os.path.exists(DB_PATH)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM raw_store_sales;")
    count = cursor.fetchone()[0]
    conn.close()
    assert count > 0

def test_jira_service_with_fallback():
    err = "table daily_store_inventory_agg has no column named inventory_status"
    issues = search_jira(err)
    assert len(issues) > 0
    assert "RETAIL-4021" in issues[0]['key']
    assert issues[0]['source'] in ["jira_rest_api", "jira_fallback"]

def test_confluence_service_and_oncall_fallback():
    err = "table daily_store_inventory_agg has no column named inventory_status"
    playbook = fetch_confluence_playbook(err)
    assert playbook is not None
    assert "ALTER TABLE" in playbook['recommended_sql']

    oncall = get_weekend_on_call_engineer()
    assert 'name' in oncall['engineer'] and len(oncall['engineer']['name']) > 0
    assert 'phone' in oncall['engineer'] and len(oncall['engineer']['phone']) > 0

def test_calle_voice_service_api_format():
    calle = CallEVoiceService()
    dummy_schema = {
        "incident_id": "INC-TEST-01",
        "oncall_engineer": {"name": "Alex Morgan", "phone": "+1-555-0199"},
        "error_context": {"dag_id": "retail_inventory_etl", "task_id": "transform_inventory_sql", "error_message": "no column named inventory_status"},
        "playbook_details": {"id": "PB-SQL-001", "title": "Missing Column", "recommended_sql": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';"},
        "jira_history": [{"key": "RETAIL-4021"}]
    }
    res = calle.call_on_call_engineer(dummy_schema)
    assert res['approved'] is True
    assert "ALTER TABLE" in res['resolution_instructions']

def test_langgraph_remediation_agent():
    init_db(reset_schema=True)
    instructions = "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';"
    val_res = run_langgraph_remediation(instructions)
    assert val_res['success'] is True
    assert val_res['records_processed'] == 4
