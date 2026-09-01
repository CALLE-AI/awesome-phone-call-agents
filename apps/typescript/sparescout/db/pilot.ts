import { getD1 } from "./index";
import { purgeExpiredSourcingData } from "./sourcing";
import {
  calculatePilotMetrics,
  type PilotQuoteRecord,
  type PilotRunRecord,
  type PilotSupplierRecord,
} from "../lib/pilot-metrics";

type RunRow = {
  request_id: string;
  status: string;
  request_created_at: string;
  run_created_at: string;
  completed_at: string | null;
};

type SupplierRow = { request_id: string; supplier_id: string };
type QuoteRow = { request_id: string; supplier_id: string; status: string; result_json: string | null };
type CountRow = { count: number };

export async function getPilotMetrics(db = getD1()) {
  await purgeExpiredSourcingData(db);
  const [runRows, supplierRows, quoteRows, fixtureCount] = await Promise.all([
    db.prepare(
      `SELECT run.request_id, run.status, request.created_at AS request_created_at,
        run.created_at AS run_created_at, run.completed_at
       FROM call_runs AS run
       INNER JOIN sourcing_requests AS request ON request.id = run.request_id
       WHERE run.mode = 'live'`,
    ).all<RunRow>(),
    db.prepare(
      `SELECT DISTINCT supplier.request_id, supplier.supplier_id
       FROM request_suppliers AS supplier
       WHERE EXISTS (
         SELECT 1 FROM call_runs AS run
         WHERE run.request_id = supplier.request_id AND run.mode = 'live'
       )`,
    ).all<SupplierRow>(),
    db.prepare(
      `SELECT quote.request_id, quote.supplier_id, quote.status, quote.result_json
       FROM supplier_quotes AS quote
       INNER JOIN call_runs AS run ON run.id = quote.call_run_id
       WHERE run.mode = 'live'`,
    ).all<QuoteRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM call_runs WHERE mode = 'fixture'").first<CountRow>(),
  ]);

  const runs: PilotRunRecord[] = runRows.results.map((row) => ({
    requestId: row.request_id,
    status: row.status,
    requestCreatedAt: row.request_created_at,
    runCreatedAt: row.run_created_at,
    completedAt: row.completed_at,
  }));
  const suppliers: PilotSupplierRecord[] = supplierRows.results.map((row) => ({
    requestId: row.request_id,
    supplierId: row.supplier_id,
  }));
  const quotes: PilotQuoteRecord[] = quoteRows.results.map((row) => ({
    requestId: row.request_id,
    supplierId: row.supplier_id,
    status: row.status,
    resultJson: row.result_json,
  }));
  return calculatePilotMetrics(runs, suppliers, quotes, Number(fixtureCount?.count ?? 0));
}
