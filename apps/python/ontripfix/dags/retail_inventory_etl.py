import datetime
import logging
import os
import sqlite3

import requests

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
    )

FASTAPI_WEBHOOK_URL = os.environ.get(
    "FLASK_WEBHOOK_URL", "http://localhost:7071/api/airflow-failure-webhook"
)
DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "db", "retail_data.db")
)


def on_failure_callback(context_or_payload):
    """
    Airflow on_failure_callback function.
    Fires when a task fails, posting error telemetry to Flask failure webhook.
    """
    if isinstance(context_or_payload, dict) and "task_id" in context_or_payload:
        payload = context_or_payload
    else:
        # Standard Airflow context dictionary
        task_instance = context_or_payload.get("task_instance")
        exception = context_or_payload.get("exception")
        payload = {
            "dag_id": context_or_payload.get("dag").dag_id
            if context_or_payload.get("dag")
            else "retail_inventory_etl",
            "task_id": task_instance.task_id
            if task_instance
            else "transform_inventory_sql",
            "execution_date": str(
                context_or_payload.get("execution_date", datetime.datetime.now())
            ),
            "error_message": str(exception)
            if exception
            else "sqlite3.OperationalError: table daily_store_inventory_agg has no column named inventory_status",
            "exception": str(exception),
        }

    logger.warning(
        f"\n[Airflow DAG Callback] Failure detected! Triggering Flask Webhook at {FASTAPI_WEBHOOK_URL}..."
    )
    try:
        logger.info(f"Payload - {payload}")
        response = requests.post(FASTAPI_WEBHOOK_URL, json=payload, timeout=10)
        logger.info(
            f"[Airflow DAG Callback] Flask Server Response Status: {response.status_code}"
        )
        logger.info(
            f"[Airflow DAG Callback] Flask Server Response Body: {response.text}"
        )
        return response.json()
    except Exception as e:
        logger.error(
            f"[Airflow DAG Callback] Failed to reach Flask Webhook endpoint: {e}"
        )
        return None


def run_retail_etl_task():
    """
    Simulates execution of Sunday night Retail Store & Inventory transformation SQL task.
    """
    logger.info(
        "\n[Airflow Task: transform_inventory_sql] Starting Sunday Night Retail ETL Transformation..."
    )
    logger.info(f"Connecting to SQLite database: {DB_PATH}")

    db_file = os.path.abspath(DB_PATH)
    if not os.path.exists(db_file):
        raise FileNotFoundError(f"Database file not found at {db_file}")

    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    # SQL Transformation query expected for Friday night batch to prepare Monday data
    sql_query = """
        INSERT INTO daily_store_inventory_agg (store_id, sales_date, total_sales, total_stock, inventory_status, updated_at)
        SELECT 
            s.store_id,
            s.sales_date,
            SUM(s.total_sales_amount) as total_sales,
            SUM(i.stock_on_hand) as total_stock,
            CASE WHEN SUM(i.stock_on_hand) > 50 THEN 'HEALTHY' ELSE 'LOW_STOCK' END as inventory_status,
            datetime('now') as updated_at
        FROM raw_store_sales s
        JOIN raw_inventory i ON s.store_id = i.store_id
        GROUP BY s.store_id, s.sales_date;
    """

    try:
        cursor.execute(sql_query)
        conn.commit()
        conn.close()
        logger.info(
            "[Airflow Task SUCCESS] Sunday Night Retail ETL completed successfully!"
        )
        return True
    except Exception as e:
        conn.close()
        logger.error(f"❌ [Airflow Task FAILED] SQL Execution Error: {e}")
        raise e


# Minimal Apache Airflow DAG Definition (for Airflow Scheduler parsing)
try:
    from airflow import DAG

    try:
        from airflow.providers.standard.operators.python import PythonOperator
    except ImportError:
        from airflow.operators.python import PythonOperator

    default_args = {
        "owner": "retail_data_team",
        "depends_on_past": False,
        "start_date": datetime.datetime(2026, 9, 1),
        "retries": 0,
        "on_failure_callback": on_failure_callback,
    }

    with DAG(
        "retail_inventory_etl",
        default_args=default_args,
        description="Friday Evening CDT Retail Store & Inventory ETL Pipeline",
        schedule="0 18 * * 5",  # Friday night 6 PM CDT
        catchup=False,
    ) as dag:
        transform_task = PythonOperator(
            task_id="transform_inventory_sql",
            python_callable=run_retail_etl_task,
        )
except (ImportError, Exception) as e:
    dag = None

if __name__ == "__main__":
    try:
        run_retail_etl_task()
    except Exception as err:
        logger.warning(f"DAG execution failed as expected with error: {err}")
