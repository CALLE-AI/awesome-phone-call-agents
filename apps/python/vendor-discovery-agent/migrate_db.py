import sqlite3
from models import DB_PATH

conn = sqlite3.connect(DB_PATH)
cols_campaigns = [r[1] for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()]
cols_leads = [r[1] for r in conn.execute("PRAGMA table_info(leads)").fetchall()]
print("campaigns:", cols_campaigns)
print("leads:", cols_leads)

campaign_cols = [
    ("consent_basis", "TEXT DEFAULT 'client-reviewed-and-approved'"),
    ("consent_approved_at", "TEXT"),
]
for col, defn in campaign_cols:
    if col not in cols_campaigns:
        conn.execute(f"ALTER TABLE campaigns ADD COLUMN {col} {defn}")
        print(f"Added campaigns.{col}")

lead_cols = [
    ("masked_phone", "TEXT"),
    ("candidate_id", "TEXT"),
    ("skip_reason", "TEXT"),
]
for col, defn in lead_cols:
    if col not in cols_leads:
        conn.execute(f"ALTER TABLE leads ADD COLUMN {col} {defn}")
        print(f"Added leads.{col}")

conn.commit()
conn.close()
print("Migration done")
