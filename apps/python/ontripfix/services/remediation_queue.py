import sqlite3
import os
import time

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'db', 'retail_data.db')

class RemediationQueue:
    def __init__(self):
        self.queue = []
        print("[Remediation Queue] Initialized execution queue.")

    def push(self, resolution_item: dict):
        print(f"[Remediation Queue] Pushing resolution task into queue for DAG '{resolution_item.get('dag_id')}'.")
        self.queue.append(resolution_item)
        return self.process_next()

    def process_next(self):
        if not self.queue:
            return False

        task_item = self.queue.pop(0)
        sql_fix = task_item.get("resolution_sql")
        print(f"[Queue Trigger Worker] Executing resolution step on database: '{sql_fix}'")

        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(sql_fix)
            conn.commit()
            conn.close()
            print("[Queue Trigger Worker] Resolution SQL executed successfully!")

            # Validate Retail ETL transformation post-fix
            validation_success = self.validate_etl_transformation()
            return validation_success
        except Exception as e:
            print(f"[Queue Trigger Worker] Error applying resolution step: {e}")
            return False

    def validate_etl_transformation(self):
        """
        Validates that the retail ETL SQL transformation can now run clean without error.
        """
        print("[Queue Trigger Worker] Validating Retail Store & Inventory ETL Transformation...")
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Execute the transformation query that previously failed
            etl_query = """
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
            cursor.execute(etl_query)
            conn.commit()
            
            # Count target rows
            cursor.execute("SELECT COUNT(*), SUM(total_sales), SUM(total_stock) FROM daily_store_inventory_agg;")
            count, sales, stock = cursor.fetchone()
            conn.close()
            
            print(f"[Validation SUCCESS] Daily Store Inventory Aggregated: {count} store records processed, Total Sales: ${sales:.2f}, Total Stock: {stock} units.")
            return True
        except Exception as e:
            print(f"[Validation FAILED] ETL query still failing: {e}")
            return False

if __name__ == "__main__":
    rq = RemediationQueue()
    res = rq.push({
        "resolution_sql": "ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';",
        "dag_id": "retail_inventory_etl",
        "task_id": "transform_inventory_sql"
    })
    print("Execution Result:", res)
