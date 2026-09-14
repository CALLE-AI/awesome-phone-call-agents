import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { ensureSchema } from "./ensure";

const dbFile = process.env.VOUCH_DB ?? join(process.cwd(), "data/vouch.db");
mkdirSync(dirname(dbFile), { recursive: true });
const sqlite = new Database(dbFile);
ensureSchema(sqlite);

const requested = JSON.stringify([
  "employment_confirmed",
  "title_stated",
  "start_date_stated",
  "end_date_stated",
  "eligible_for_rehire",
  "salary_history",
]);
const consented = requested;

sqlite.exec(`
  DELETE FROM runs;
  DELETE FROM consents;
  INSERT OR REPLACE INTO settings (key, value) VALUES ('killed', '0');
`);

const insert = sqlite.prepare(
  `INSERT INTO consents (
    id, candidate_name, employer, employer_id, jurisdiction, requested_json, consent_fields_json,
    signed_at, expires_at, revoked_at, requesting_org, employer_code, phone_masked, script_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

insert.run(
  "cns_demo",
  "Alex Rivera",
  "Northbay Civic Works",
  "emp_northbay",
  "US-CA",
  requested,
  consented,
  "2026-08-12",
  "2026-11-12",
  null,
  "Harbor Lane Staffing",
  "NB-4491",
  "+1 707 ••• ••40",
  "hr_confirm",
);

insert.run(
  "cns_gate",
  "Sam Cole",
  "Harborline Logistics",
  "emp_harborline",
  "US-CA",
  requested,
  consented,
  "2026-08-20",
  "2026-11-20",
  null,
  "Harbor Lane Staffing",
  "HL-2201",
  "+1 415 ••• ••16",
  "third_party",
);

insert.run(
  "cns_revoked",
  "Jordan Hale",
  "Pacific Yard Services",
  "emp_pacific",
  "US-CA",
  requested,
  consented,
  "2026-07-01",
  "2026-10-01",
  "2026-09-02",
  "Harbor Lane Staffing",
  "PY-8810",
  "+1 510 ••• ••22",
  "hr_confirm",
);

console.log(`[seed] wrote 3 consents to ${dbFile}`);
sqlite.close();
