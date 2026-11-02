"""SQLite ownership: CRM tables and Agent records share a local demo file.

Short BEGIN IMMEDIATE transactions serialize edits and idempotent writes. No
network operation may run inside a transaction. User data is never deleted.
"""
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from importlib.resources import files
from pathlib import Path


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def digest(value):
    return hashlib.sha256(dump(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def fixture(name):
    return json.loads(files("real_estate_buyer_followup").joinpath("data", name).read_text())


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.tx() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, version INTEGER, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS properties(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS viewings(id TEXT PRIMARY KEY, customer_id TEXT, property_id TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS communications(id TEXT PRIMARY KEY, customer_id TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, revision INTEGER, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, run_id TEXT, payload_hash TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS changes(id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, field TEXT, old_value TEXT, new_value TEXT, evidence TEXT, created_at TEXT);
            CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, run_id TEXT, kind TEXT, data TEXT NOT NULL, UNIQUE(run_id,kind));
            """)
        seed = fixture("crm.json")
        with self.tx() as db:
            c = seed["customer"]
            # Fixtures are an initial snapshot, not a migration. Never merge
            # newer scenario history into an existing customer database.
            if db.execute("SELECT 1 FROM customers WHERE id=?",(c['id'],)).fetchone():
                return
            db.execute("INSERT OR IGNORE INTO customers VALUES(?,?,?)", (c["id"], c["version"], dump(c)))
            for prop in seed["properties"]:
                db.execute("INSERT OR IGNORE INTO properties VALUES(?,?)", (prop["id"], dump(prop)))
            for v in seed["viewings"]:
                db.execute("INSERT OR IGNORE INTO viewings VALUES(?,?,?,?)", (v["id"], v["customer_id"], v["property_id"], dump(v)))
            for item in seed["communications"]:
                db.execute("INSERT OR IGNORE INTO communications VALUES(?,?,?)", (item["id"], c["id"], dump(item)))

    @contextmanager
    def tx(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def run(self, run_id):
        with self.tx() as db:
            row = db.execute("SELECT data FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise ValueError("找不到该任务")
            return json.loads(row[0])

    def create_run(self, run):
        with self.tx() as db:
            db.execute("INSERT INTO runs VALUES(?,?,?)", (run["id"], run["revision"], dump(run)))

    def save_run(self, run, expected_revision):
        with self.tx() as db:
            self.save_in(db, run, expected_revision)

    @staticmethod
    def save_in(db, run, expected_revision):
        cursor = db.execute("UPDATE runs SET revision=?,data=? WHERE id=? AND revision=?",
                            (run["revision"], dump(run), run["id"], expected_revision))
        if cursor.rowcount != 1:
            raise ValueError("任务已被其他操作修改，请重新载入")

    def list_runs(self):
        with self.tx() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT data FROM runs ORDER BY rowid DESC")]

    def history(self, customer_id):
        with self.tx() as db:
            rows = db.execute("SELECT c.* FROM changes c JOIN runs r ON c.run_id=r.id WHERE json_extract(r.data,'$.customer_id')=? ORDER BY c.created_at", (customer_id,)).fetchall()
            return [dict(r) for r in rows]
