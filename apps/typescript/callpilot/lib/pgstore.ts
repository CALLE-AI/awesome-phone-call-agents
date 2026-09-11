// Durable Postgres store (used when DATABASE_URL is set, e.g. Vercel +
// Supabase/Neon). Mirrors database/schema.sql. All writes run inside a
// transaction with a row lock on the task so concurrent event pushes
// (progress polling + finalize + webhook) cannot lose updates.

import postgres from "postgres";
import type { CallEvent, Mission } from "@/types";
import { GUARDRAILS } from "@/lib/planner";

let sql: ReturnType<typeof postgres> | null = null;
let schemaReady = false;

export function pgEnabled(): boolean {
  return (process.env.DATABASE_URL ?? "").length > 10;
}

function client() {
  // prepare:false is REQUIRED for pooled connections (Neon pooler /
  // PgBouncer transaction mode): prepared statements do not survive
  // across pooled sessions and repeat queries would fail.
  if (!sql) sql = postgres(process.env.DATABASE_URL as string, { max: 3, idle_timeout: 10, connect_timeout: 10, prepare: false });
  return sql;
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = client();
  await db.unsafe(`
    create table if not exists users (id uuid primary key default gen_random_uuid(), email text unique not null, created_at timestamptz default now());
    create table if not exists templates (id text primary key, name text not null, goal text not null, questions jsonb default '[]', constraints jsonb default '[]', desired_outcome text default '');
    create table if not exists tasks (id uuid primary key, mission_number int not null, title text not null, target_name text not null, phone_e164 text not null, category text not null, goal text not null, questions jsonb default '[]', constraints jsonb default '[]', desired_outcome text default '', safety_mode text default 'approval_required', demo_mode boolean default false, status text default 'planned', created_at timestamptz default now(), updated_at timestamptz default now());
    create table if not exists calls (id uuid primary key default gen_random_uuid(), task_id uuid references tasks(id) on delete cascade, calle_call_id text, calle_run_id text, provider text default 'calle-live', status text default 'dialing', elapsed_seconds int default 0, error text, created_at timestamptz default now());
    create table if not exists call_events (id uuid primary key, task_id uuid references tasks(id) on delete cascade, kind text not null, message text not null, meta jsonb default '{}', created_at timestamptz default now());
    create index if not exists idx_events_task on call_events(task_id, created_at);
    create table if not exists agent_runs (id uuid primary key default gen_random_uuid(), task_id uuid references tasks(id) on delete cascade, instructions text not null, result_schema jsonb default '{}', created_at timestamptz default now());
    create table if not exists call_results (id uuid primary key default gen_random_uuid(), task_id uuid references tasks(id) on delete cascade, structured jsonb not null, confidence numeric, created_at timestamptz default now());
    create table if not exists meta (k text primary key, v text not null);
  `);
  await db.unsafe(`insert into meta(k, v) values ('mission_counter', '1042') on conflict (k) do nothing`);
  schemaReady = true;
}

/** Self-healing decode: unwrap values that were stored as multiply-stringified JSON. */
function deepParse(v: unknown, depth = 0): unknown {
  let cur = v;
  for (let i = 0; i < 10 && typeof cur === "string"; i++) {
    try { cur = JSON.parse(cur); } catch { break; }
  }
  void depth;
  return cur;
}

function asStrArray(v: unknown): string[] {
  const p = deepParse(v);
  return Array.isArray(p) ? p.map(String) : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  const p = deepParse(v);
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
}

function rowToMission(  t: Record<string, unknown>,
  call: Record<string, unknown> | null,
  events: Record<string, unknown>[],
  agent: Record<string, unknown> | null,
  result: Record<string, unknown> | null
): Mission {
  return {
    id: t["id"] as string,
    number: t["mission_number"] as number,
    title: t["title"] as string,
    targetName: t["target_name"] as string,
    phoneE164: t["phone_e164"] as string,
    category: t["category"] as Mission["category"],
    goal: t["goal"] as string,
    questions: asStrArray(t["questions"]),
    constraints: asStrArray(t["constraints"]),
    desiredOutcome: (t["desired_outcome"] as string) ?? "",
    safetyMode: t["safety_mode"] as Mission["safetyMode"],
    demoMode: (t["demo_mode"] as boolean) ?? false,
    status: t["status"] as Mission["status"],
    createdAt: new Date(t["created_at"] as string).toISOString(),
    updatedAt: new Date(t["updated_at"] as string).toISOString(),
    plan: agent
      ? {
          objective: (t["goal"] as string) ?? "",
          target: (t["target_name"] as string) ?? "",
          questions: asStrArray(t["questions"]),
          constraints: asStrArray(t["constraints"]),
          success_condition: (t["desired_outcome"] as string) ?? "",
          agentInstructions: agent["instructions"] as string,
          resultSchema: asRecord(agent["result_schema"]) ?? {},
          safety: { mode: t["safety_mode"] as Mission["safetyMode"], guardrails: GUARDRAILS[t["safety_mode"] as Mission["safetyMode"]] ?? [] },
        }
      : null,
    callId: (call?.["calle_call_id"] as string) ?? null,
    calleRunId: (call?.["calle_run_id"] as string) ?? null,
    events: events.map((e) => ({
      id: e["id"] as string,
      missionId: t["id"] as string,
      ts: new Date(e["created_at"] as string).toISOString(),
      kind: e["kind"] as string,
      message: e["message"] as string,
      meta: asRecord(e["meta"]) ?? {},
    })),
    result: (asRecord(result?.["structured"]) as Mission["result"]) ?? null,
    elapsedSeconds: (call?.["elapsed_seconds"] as number) ?? 0,
    provider: ((call?.["provider"] as string) ?? "calle-mock") as Mission["provider"],
    error: (call?.["error"] as string) ?? null,
  };
}

async function loadMissionTx(db: postgres.TransactionSql, id: string): Promise<Mission | null> {
  const tasks = await db`select * from tasks where id = ${id}`;
  if (tasks.length === 0) return null;
  const t = tasks[0] as Record<string, unknown>;
  const calls = await db`select * from calls where task_id = ${id} order by created_at desc limit 1`;
  const events = await db`select * from call_events where task_id = ${id} order by created_at asc`;
  const agents = await db`select * from agent_runs where task_id = ${id} order by created_at desc limit 1`;
  const results = await db`select * from call_results where task_id = ${id} order by created_at desc limit 1`;
  return rowToMission(
    t,
    (calls[0] as Record<string, unknown> | undefined) ?? null,
    events as Record<string, unknown>[],
    (agents[0] as Record<string, unknown> | undefined) ?? null,
    (results[0] as Record<string, unknown> | undefined) ?? null
  );
}

export async function pgListMissions(): Promise<Mission[]> {
  await ensureSchema();
  const db = client();
  const tasks = await db`select * from tasks order by created_at desc limit 100`;
  const out: Mission[] = [];
  for (const t of tasks) {
    const m = await loadMissionTx(db as unknown as postgres.TransactionSql, (t as Record<string, unknown>)["id"] as string);
    if (m) out.push(m);
  }
  return out;
}

export async function pgGetMission(id: string): Promise<Mission | null> {
  await ensureSchema();
  return client().begin((tx) => loadMissionTx(tx, id));
}

export async function pgSaveMission(m: Mission): Promise<Mission> {
  await ensureSchema();
  const db = client();
  await db.begin(async (tx) => {
    await tx`insert into tasks (id, mission_number, title, target_name, phone_e164, category, goal, questions, constraints, desired_outcome, safety_mode, demo_mode, status, created_at, updated_at)
      values (${m.id}, ${m.number}, ${m.title}, ${m.targetName}, ${m.phoneE164}, ${m.category}, ${m.goal}, ${JSON.stringify(m.questions)}::jsonb, ${JSON.stringify(m.constraints)}::jsonb, ${m.desiredOutcome}, ${m.safetyMode}, ${m.demoMode}, ${m.status}, ${m.createdAt}, ${m.updatedAt})
      on conflict (id) do update set mission_number = excluded.mission_number, title = excluded.title, target_name = excluded.target_name, phone_e164 = excluded.phone_e164, category = excluded.category, goal = excluded.goal, questions = excluded.questions, constraints = excluded.constraints, desired_outcome = excluded.desired_outcome, safety_mode = excluded.safety_mode, demo_mode = excluded.demo_mode, status = excluded.status, updated_at = excluded.updated_at`;
    await tx`select * from tasks where id = ${m.id} for update`;
    if (m.plan) {
      await tx`delete from agent_runs where task_id = ${m.id}`;
      await tx`insert into agent_runs (task_id, instructions, result_schema) values (${m.id}, ${m.plan.agentInstructions}, ${JSON.stringify(m.plan.resultSchema)}::jsonb)`;
    }
    await tx`delete from calls where task_id = ${m.id}`;
    await tx`insert into calls (task_id, calle_call_id, calle_run_id, provider, status, elapsed_seconds, error) values (${m.id}, ${m.callId}, ${m.calleRunId}, ${m.provider}, ${m.status}, ${m.elapsedSeconds}, ${m.error})`;
    const existing = await tx`select id from call_events where task_id = ${m.id}`;
    const have = new Set(existing.map((r) => (r as Record<string, unknown>)["id"] as string));
    for (const e of m.events) {
      if (have.has(e.id)) continue;
      await tx`insert into call_events (id, task_id, kind, message, meta) values (${e.id}, ${m.id}, ${e.kind}, ${e.message}, ${JSON.stringify(e.meta ?? {})}::jsonb) on conflict (id) do nothing`;
    }
    if (m.result) {
      await tx`delete from call_results where task_id = ${m.id}`;
      await tx`insert into call_results (task_id, structured, confidence) values (${m.id}, ${JSON.stringify(m.result)}::jsonb, ${m.result.confidence})`;
    }
  });
  return m;
}

export async function pgNextMissionNumber(): Promise<number> {
  await ensureSchema();
  const db = client();
  const rows = await db`update meta set v = (v::int + 1)::text where k = 'mission_counter' returning v::int as n`;
  return (rows[0] as unknown as { n: number }).n - 1;
}
