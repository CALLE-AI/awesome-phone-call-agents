import os
import sys
import pytest
import sqlite3

# Add root directory to python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from db.init_sqlite import init_db, DB_PATH
from services.jira_service import search_jira, create_jira_ticket, add_jira_comment, update_jira_ticket_status

from services.confluence_service import fetch_confluence_playbook, get_ontripfix_on_call_engineer
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
    assert isinstance(issues, list)


def test_create_jira_ticket():
    ticket = create_jira_ticket("INC-TEST-99", "retail_inventory_etl", "transform_inventory_sql", "Missing column inventory_status")
    assert ticket is not None
    assert "key" in ticket
    assert ticket["project"] in ["DIM", "RETAIL", os.environ.get("JIRA_PROJECT_KEY", "DIM")]

def test_add_jira_comment():
    res = add_jira_comment("DIM-4022", "Test incident progress update comment.")
    assert res is True

def test_update_jira_ticket_status():
    res_inp = update_jira_ticket_status("DIM-4022", "In Progress")
    assert res_inp is True
    res_done = update_jira_ticket_status("DIM-4022", "Done")
    assert res_done is True



def test_confluence_service_and_oncall_fallback():
    err = "table daily_store_inventory_agg has no column named inventory_status"
    playbook = fetch_confluence_playbook(err)
    assert playbook is not None
    assert "ALTER TABLE" in playbook['recommended_sql']

    oncall = get_ontripfix_on_call_engineer()
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
    assert res.get('user_id_validated') is True
    assert "ALTER TABLE" in res['resolution_instructions']


def test_langgraph_remediation_agent():
    init_db(reset_schema=True)
    instructions = "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';"
    val_res = run_langgraph_remediation(instructions)
    assert val_res['success'] is True
    assert val_res['records_processed'] == 4

def test_ai_bug_diagnosis_fallback():
    err = "sqlite3.OperationalError: table daily_store_inventory_agg has no column named unknown_custom_column"
    playbook = fetch_confluence_playbook(err, dag_id="retail_inventory_etl", task_id="transform_inventory_sql")
    assert playbook is not None
    assert playbook.get("source") == "langchain_ai_diagnosis"
    assert "recommended_sql" in playbook
    assert "unknown_custom_column" in playbook["recommended_sql"]

def test_fastapi_endpoints():
    from fastapi.testclient import TestClient
    from fastapi_app.app import app
    client = TestClient(app)

    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ONLINE"

    stats_res = client.get("/api/dashboard/stats")
    assert stats_res.status_code == 200
    assert "total_incidents" in stats_res.json()

    queues_res = client.get("/api/queues")
    assert queues_res.status_code == 200
    assert "error_queue" in queues_res.json()


