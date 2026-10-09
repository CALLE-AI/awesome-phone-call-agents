import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { Disposition } from "@caller-ai/core/dispositions";
import { linkEvidence } from "@caller-ai/core/evidence";
import { headcountKey } from "@caller-ai/core/idempotency";
import { triageAttempt } from "../lib/escalate";
import { compileTaskText } from "../lib/instrument";
import { loadCallScript, ROSTER_SCRIPTS } from "../lib/scripts";
import { ensureSchema } from "./ensure";

const eventId = "evt_bennett_valley";
const instrumentId = "ins_casper_v1";
const waveId = "wav_1";
const afterAction = process.env.SEED_MODE === "after";

const roster = [
  { id: "rst_01", name: "Household 01", phone: "+15555550101", masked: "+1 555 ••• ••01", hh: 3 },
  { id: "rst_02", name: "Household 02", phone: "+15555550102", masked: "+1 555 ••• ••02", hh: 2 },
  { id: "rst_03", name: "Household 03", phone: "+15555550103", masked: "+1 555 ••• ••03", hh: 4 },
  { id: "rst_04", name: "Household 04", phone: "+15555550104", masked: "+1 555 ••• ••04", hh: 2 },
  { id: "rst_05", name: "Household 05", phone: "+15555550105", masked: "+1 555 ••• ••05", hh: 1 },
  { id: "rst_06", name: "Household 06", phone: "+15555550108", masked: "+1 555 ••• ••08", hh: 5 },
  { id: "rst_07", name: "Household 07", phone: "+15555550109", masked: "+1 555 ••• ••09", hh: 3 },
  { id: "rst_08", name: "Household 08", phone: "+15555550110", masked: "+1 555 ••• ••10", hh: 2 },
  { id: "rst_09", name: "Household 09", phone: "+15555550111", masked: "+1 555 ••• ••11", hh: 6 },
  { id: "rst_10", name: "Household 10", phone: "+15555550112", masked: "+1 555 ••• ••12", hh: 2 },
  { id: "rst_11", name: "Household 11", phone: "+15555550113", masked: "+1 555 ••• ••13", hh: 1 },
  { id: "rst_12", name: "Household 12", phone: "+15555550114", masked: "+1 555 ••• ••14", hh: 4 },
];

const taskText = compileTaskText({
  agency: "Sonoma County Emergency Management",
  event: "Bennett Valley fire (CASPER drill)",
  callback: "+1 707 ••• ••00",
});

const dbFile = process.env.HEADCOUNT_DB ?? join(dirname(fileURLToPath(import.meta.url)), "../../data/headcount.db");
mkdirSync(dirname(dbFile), { recursive: true });
const sqlite = new Database(dbFile);
ensureSchema(sqlite);

sqlite.exec(`
  DELETE FROM triage_cards;
  DELETE FROM attempts;
  DELETE FROM waves;
  DELETE FROM roster;
  DELETE FROM instruments;
  DELETE FROM events;
  INSERT OR REPLACE INTO settings (key, value) VALUES ('killed', '0');
`);

sqlite
  .prepare(
    `INSERT INTO events (id, name, agency, timezone, callback_number, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  )
  .run(
    eventId,
    "Bennett Valley fire — CASPER drill",
    "Sonoma County Emergency Management",
    "America/Los_Angeles",
    "+1 707 ••• ••00",
  );

sqlite
  .prepare(
    `INSERT INTO instruments (id, event_id, version, title, questions_json, task_text)
     VALUES (?, ?, 1, ?, ?, ?)`,
  )
  .run(instrumentId, eventId, "CASPER household needs check v1", JSON.stringify([
    "Is everyone in the household safe and accounted for?",
    "Are you sheltering in place, or have you evacuated?",
    "Do you have electricity right now? Running water?",
    "Does anyone need prescription medication you cannot get?",
    "Is there anything urgent you need help with right now?",
  ]), taskText);

const insertRoster = sqlite.prepare(
  `INSERT INTO roster (id, event_id, display_name, phone_masked, phone_e164, region, locale, timezone, household_size, flags_json)
   VALUES (?, ?, ?, ?, ?, 'US', 'en-US', 'America/Los_Angeles', ?, ?)`,
);

for (const row of roster) {
  insertRoster.run(row.id, eventId, row.name, row.masked, row.phone, row.hh, "[]");
}

if (!afterAction) {
  console.log(`[seed] empty drill — ${roster.length} roster rows at ${dbFile}`);
  console.log("[seed] confirm wave 1 to start. After-action screenshots: pnpm db:seed:after");
  sqlite.close();
  process.exit(0);
}

sqlite
  .prepare(
    `INSERT INTO waves (id, event_id, instrument_id, wave_no, filter_json, budget_cap, status)
     VALUES (?, ?, ?, 1, ?, 12, 'complete')`,
  )
  .run(waveId, eventId, instrumentId, JSON.stringify({ slice: "full_roster" }));

const insertAttempt = sqlite.prepare(
  `INSERT INTO attempts (id, wave_id, roster_entry_id, run_id, idempotency_key, disposition, result_json, transcript_json, evidence_json, confidence_score, status, started_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'terminal', ?)`,
);
const insertTriage = sqlite.prepare(
  `INSERT INTO triage_cards (id, event_id, attempt_id, roster_entry_id, severity, needs_json, assignee, status)
   VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
);

const now = Date.now();
for (const row of roster) {
  const script = loadCallScript(ROSTER_SCRIPTS[row.id] ?? "cooperative");
  const linked = linkEvidence({
    structuredResult: script.result,
    evidence: script.evidence,
    turns: script.turns,
  });
  const triage = triageAttempt({
    disposition: script.disposition as Disposition,
    result: script.result,
    linked,
    confidence: script.confidence,
  });
  const attemptId = `att_${row.id}_w1`;
  insertAttempt.run(
    attemptId,
    waveId,
    row.id,
    `sim_${ROSTER_SCRIPTS[row.id]}_1`,
    headcountKey({ eventId, rosterEntryId: row.id, waveNo: 1, instrumentVersion: 1 }),
    script.disposition,
    JSON.stringify(script.result),
    JSON.stringify(script.turns),
    JSON.stringify(script.evidence),
    String(script.confidence),
    now,
  );
  insertTriage.run(
    `tri_${row.id}_w1`,
    eventId,
    attemptId,
    row.id,
    triage.severity,
    JSON.stringify(triage.needs),
    triage.dispatch ? "open" : triage.severity === "safe" ? "closed" : "open",
  );
}

const unaccounted = sqlite.prepare(`SELECT COUNT(*) AS n FROM triage_cards WHERE severity = 'unaccounted'`).get() as { n: number };
const critical = sqlite.prepare(`SELECT COUNT(*) AS n FROM triage_cards WHERE severity = 'critical'`).get() as { n: number };
console.log(`[seed] after-action — ${roster.length} completed calls at ${dbFile}`);
console.log(`[seed] triage ${critical.n} critical / ${unaccounted.n} unaccounted`);
sqlite.close();
