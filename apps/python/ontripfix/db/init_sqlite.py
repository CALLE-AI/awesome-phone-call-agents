import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "retail_data.db")


def init_db(reset_schema=True):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if reset_schema:
        print("[DB Init] Resetting database tables...")
        cursor.execute("DROP TABLE IF EXISTS raw_store_sales;")
        cursor.execute("DROP TABLE IF EXISTS raw_inventory;")
        cursor.execute("DROP TABLE IF EXISTS daily_store_inventory_agg;")

    # Source 1: Raw Store Sales
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS raw_store_sales (
            store_id INTEGER,
            sales_date TEXT,
            total_sales_amount REAL,
            transactions_count INTEGER
        );
    """)

    # Source 2: Raw Inventory
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS raw_inventory (
            store_id INTEGER,
            product_id INTEGER,
            stock_on_hand INTEGER,
            reorder_level INTEGER,
            last_restock_date TEXT
        );
    """)

    # Target Table: Initial schema WITHOUT 'inventory_status' (causes Sunday night ETL SQL error)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_store_inventory_agg (
            store_id INTEGER,
            sales_date TEXT,
            total_sales REAL,
            total_stock INTEGER,
            updated_at TEXT
        );
    """)

    # Populate sample retail data
    cursor.execute("DELETE FROM raw_store_sales;")
    cursor.execute("DELETE FROM raw_inventory;")

    # Insert sample sales for Sunday night CDT batch
    cursor.executemany(
        """
        INSERT INTO raw_store_sales (store_id, sales_date, total_sales_amount, transactions_count)
        VALUES (?, ?, ?, ?);
    """,
        [
            (101, "2026-09-06", 15420.50, 320),
            (102, "2026-09-06", 22310.00, 450),
            (103, "2026-09-06", 8940.75, 180),
            (104, "2026-09-06", 31200.25, 610),
        ],
    )

    # Insert sample inventory
    cursor.executemany(
        """
        INSERT INTO raw_inventory (store_id, product_id, stock_on_hand, reorder_level, last_restock_date)
        VALUES (?, ?, ?, ?, ?);
    """,
        [
            (101, 501, 150, 50, "2026-09-01"),
            (101, 502, 30, 40, "2026-08-28"),
            (102, 501, 200, 60, "2026-09-02"),
            (103, 503, 10, 25, "2026-08-25"),
            (104, 501, 500, 100, "2026-09-04"),
        ],
    )

    conn.commit()
    conn.close()
    print(f"[DB Init] Retail Database initialized successfully at '{DB_PATH}'")


if __name__ == "__main__":
    init_db()
