import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productionSchema = readFileSync(new URL("../supabase/migrations/001_production_schema.sql", import.meta.url), "utf8");
const safetyMigration = readFileSync(new URL("../supabase/migrations/003_atomic_call_previews.sql", import.meta.url), "utf8");

test("preview creation serializes each requester-recipient slot", () => {
  for (const sql of [productionSchema, safetyMigration]) {
    assert.match(sql, /create_call_preview/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /status not in \('completed','failed'/);
  }
});

test("call sessions are requester-only and old transcript evidence is purged", () => {
  assert.match(productionSchema, /requested_by=auth\.uid\(\) and public\.is_company_member/);
  assert.match(safetyMigration, /result \? 'transcriptEvidence'/);
  assert.match(safetyMigration, /requested_by=auth\.uid\(\) and public\.is_company_member/);
});
