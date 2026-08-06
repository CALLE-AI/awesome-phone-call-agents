import { envFromProcess, storeFor } from "../_lib/calls";
import { authenticateOperator, operatorCanAccessSenior } from "../_lib/operator-auth";

export const config = { runtime: "edge" };
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers });

interface CaseRecord { id: string; seniorId: string; acknowledged?: boolean; [key: string]: unknown }

export default async function handler(request: Request): Promise<Response> {
  const env = envFromProcess();
  const operator = await authenticateOperator(request, env);
  if (!operator) return json({ error: "invalid_operator_session" }, 401);
  const store = storeFor(env);
  if (!store) return json({ error: "durable_storage_not_configured" }, 503);

  if (request.method === "GET") {
    const ids = await store.readIndex("carecall:cases:index", 100);
    const records = await Promise.all(ids.map((id) => store.get<CaseRecord>(`carecall:case:${id}`)));
    return json({ cases: records.filter((item): item is CaseRecord => Boolean(item && !item.acknowledged && operatorCanAccessSenior(operator, item.seniorId))) });
  }

  if (request.method === "PATCH") {
    let body: { case_id?: string; acknowledged?: boolean };
    try { body = await request.json() as typeof body; } catch { return json({ error: "invalid_json" }, 400); }
    if (!body.case_id || body.acknowledged !== true) return json({ error: "invalid_case_update" }, 400);
    const record = await store.get<CaseRecord>(`carecall:case:${body.case_id}`);
    if (!record) return json({ error: "case_not_found" }, 404);
    if (!operatorCanAccessSenior(operator, record.seniorId)) return json({ error: "senior_scope_denied" }, 403);
    const updated = { ...record, acknowledged: true, acknowledgedBy: operator.id, acknowledgedAt: new Date().toISOString() };
    await store.set(`carecall:case:${record.id}`, updated, 365 * 24 * 60 * 60);
    return json({ case: updated });
  }

  return json({ error: "method_not_allowed" }, 405);
}
