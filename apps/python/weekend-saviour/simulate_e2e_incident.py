import os
import sys
import time
import multiprocessing
from db.init_sqlite import init_db
from flask_app.app import app
from dags.retail_inventory_etl import run_retail_etl_task


def run_flask_incident_server():
    """Runs the FastAPI Incident Remediation Server with Error and Resolution Queues."""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=7071, log_level="warning")


def main():
    print("=" * 85)
    print(
        "🚀 STARTING CALL-E AUTONOMOUS INCIDENT RESPONSE & LANGGRAPH REMEDIATION SIMULATION"
    )
    print("=" * 85)

    # Step 1: Initialize DB to fresh state (with missing column failure condition)
    print("\n--- PHASE 1: DATABASE INITIALIZATION ---")
    init_db(reset_schema=True)

    # Step 2: Start Flask Webhook & Queue Server
    print(
        "\n--- PHASE 2: STARTING FLASK INCIDENT REMEDIATION SERVER & QUEUE WORKERS ---"
    )
    server_process = multiprocessing.Process(target=run_flask_incident_server)
    server_process.daemon = True
    server_process.start()
    time.sleep(3)  # Give server time to bind port and start uvicorn

    # Step 3: Execute Airflow DAG task (expected to fail)
    print("\n--- PHASE 3: RUNNING SUNDAY NIGHT RETAIL ETL AIRFLOW DAG ---")
    try:
        run_retail_etl_task()
    except Exception as e:
        print(f"\n[Simulation Engine] Expected DAG failure caught: {e}")

    # Wait for background queue processing, Jira/Confluence checks, Call-E call & LangGraph execution
    time.sleep(6)

    # Step 4: Re-trigger Airflow DAG task post-remediation
    print("\n--- PHASE 4: RE-RUNNING AIRFLOW DAG POST-REMEDIATION ---")
    print(
        "[Simulation Engine] Re-running Sunday Night Retail ETL DAG task after LangGraph remediation..."
    )
    dag_success = run_retail_etl_task()

    print("\n" + "=" * 85)
    if dag_success:
        print(
            "🎉 SUCCESS: Call-E Incident Response & LangGraph Auto-Remediation Workflow Complete!"
        )
        print("   - Initial DAG SQL Failure Enqueued to Flask Error Queue")
        print(
            "   - Jira API Title/Description Search & Confluence Playbook Lookup Executed"
        )
        print(
            "   - Confluence Team Calendar & Local Config Fallback Checked (Alex Morgan contacted)"
        )
        print(
            "   - Call-E Outbound Voice Call Triggered (https://docs.heycall-e.com/calls)"
        )
        print("   - Resolution Instructions Enqueued to Resolution Queue")
        print(
            "   - LangGraph StateGraph & Gemini Tools Executed Schema Fix on SQLite DB"
        )
        print(
            "   - Airflow DAG Re-run Succeeded & Call-E Follow-up Confirmation Placed!"
        )
    else:
        print("❌ SIMULATION FAILED")
    print("=" * 85)

    server_process.terminate()


if __name__ == "__main__":
    main()
