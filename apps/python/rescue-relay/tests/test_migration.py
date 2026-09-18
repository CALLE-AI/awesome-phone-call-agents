import sqlite3
import app as relay


def test_original_schema_and_data_are_retained(client, tmp_path, monkeypatch):
    old = tmp_path / "old-v1.db"
    with sqlite3.connect(old) as db:
        db.executescript("""
        CREATE TABLE businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,description TEXT NOT NULL,consent_to_contact INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
        CREATE TABLE incidents(id TEXT PRIMARY KEY,summary TEXT NOT NULL,location TEXT NOT NULL,reporter_name TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE coordination_runs(id TEXT PRIMARY KEY,incident_id TEXT NOT NULL REFERENCES incidents(id),mode TEXT NOT NULL,status TEXT NOT NULL,plan_json TEXT,started_at TEXT NOT NULL,completed_at TEXT,approved_at TEXT);
        CREATE TABLE calls(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES coordination_runs(id),incident_id TEXT NOT NULL REFERENCES incidents(id),business_id TEXT NOT NULL REFERENCES businesses(id),status TEXT NOT NULL,provider_call_id TEXT,result_json TEXT,error TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        INSERT INTO businesses VALUES('saved','My existing team','+12025550198','My approved trained response team.',1,1,'2026-01-01');
        INSERT INTO incidents VALUES('old_report','An existing animal welfare report.','My saved location',NULL,'calling','2026-01-01');
        INSERT INTO coordination_runs VALUES('old_run','old_report','live','running',NULL,'2026-01-01',NULL,NULL);
        INSERT INTO calls VALUES('old_call','old_run','old_report','saved','waiting','call_real_existing',NULL,NULL,'old-idempotency','2026-01-01','2026-01-01');
        """)
    monkeypatch.setattr(relay, "DB_PATH", old)
    relay.init_db()
    contacts = client.get("/api/businesses").json()
    assert len(contacts) == 1
    assert contacts[0]["name"] == "My existing team"
    assert contacts[0]["consent_to_contact"] is True
    run = client.get("/api/runs/old_run").json()
    assert run["legacy"]
    assert run["status"] == "interrupted"
    assert run["calls"][0]["provider_call_id"] == "call_real_existing"
    assert client.get("/api/incidents/old_report").json()["location"] == "My saved location"
    assert client.post("/api/demo/reset").status_code == 409
