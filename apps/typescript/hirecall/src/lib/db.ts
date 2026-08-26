import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Batch, CallResponse, CallStatus, Candidate, CandidateInput, RecruiterDecision } from "@/lib/types";
import { parseScreeningResult } from "@/lib/call-result-schema";
import { readResumeTextFromUrl } from "@/lib/fetch-resume";
import { generateCallPrompt, generateFollowUpCallPrompt, passScore, type PromptSource } from "@/lib/generate-call-prompt";
import { DEFAULT_SCORE_CONFIG, parseScoreConfig } from "@/lib/score-config";
import { DEMO_CALL_PROMPT, DEMO_FILENAME, DEMO_JOB_ROLE, DEMO_NAME, DEMO_RESUME_TEXT } from "@/lib/demo-candidate";
import { isValidE164, normalizePhone } from "@/lib/parse-workbook";
import { looksMasked } from "@/lib/phone";
import { rosterStatus } from "@/lib/status";

export type { Batch, Candidate, CandidateInput };

const globalForDb = globalThis as unknown as { hirecallClient?: Client };

function dbFileUrl(): string {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  return "file:data/hirecall.db";
}

function getClient(): Client {
  if (!globalForDb.hirecallClient) {
    globalForDb.hirecallClient = createClient({ url: dbFileUrl() });
  }
  return globalForDb.hirecallClient;
}

const CALL_STATUSES = new Set<CallStatus>([
  "not_called",
  "queued",
  "calling",
  "talking",
  "completed",
  "no_answer",
  "failed",
]);

function parseCallStatus(value: unknown): CallStatus {
  const status = String(value ?? "");
  return CALL_STATUSES.has(status as CallStatus) ? (status as CallStatus) : "not_called";
}

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row) => String((row as unknown as { name: unknown }).name)));
}

async function addColumnIfMissing(
  client: Client,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await tableColumns(client, table);
  if (columns.has(column)) return;
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function backfillBatches(client: Client) {
  const orphans = await client.execute(
    `SELECT DISTINCT source_filename, created_at
     FROM candidates
     WHERE batch_id = '' OR batch_id IS NULL`,
  );

  for (const row of orphans.rows) {
    const filename = String(row.source_filename ?? "unknown.xlsx");
    const createdAt = String(row.created_at ?? new Date().toISOString());
    const id = crypto.randomUUID();
    await client.execute({
      sql: "INSERT INTO batches (id, filename, created_at) VALUES (?, ?, ?)",
      args: [id, filename, createdAt],
    });
    await client.execute({
      sql: `UPDATE candidates
            SET batch_id = ?
            WHERE (batch_id = '' OR batch_id IS NULL)
              AND source_filename = ?
              AND created_at = ?`,
      args: [id, filename, createdAt],
    });
  }
}

async function migrate(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      consent INTEGER NOT NULL DEFAULT 0,
      resume_url TEXT NOT NULL DEFAULT '',
      source_filename TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await addColumnIfMissing(client, "candidates", "batch_id", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(
    client,
    "candidates",
    "call_status",
    "TEXT NOT NULL DEFAULT 'not_called'",
  );
  await addColumnIfMissing(client, "candidates", "resume_text", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "resume_fetched_at", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "resume_fetch_error", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "call_prompt", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "job_role", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "active", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(client, "batches", "active", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(client, "batches", "job_role", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "batches", "system_prompt", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "batches", "score_criteria", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "calle_call_id", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "candidates", "call_attempt", "INTEGER NOT NULL DEFAULT 0");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS call_responses (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      calle_call_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      ended_at TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER,
      result_json TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await addColumnIfMissing(client, "call_responses", "summary", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "call_responses", "decision", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(client, "call_responses", "score", "INTEGER");
  await backfillBatches(client);
}

function parseDecision(value: unknown): RecruiterDecision {
  const decision = String(value ?? "");
  if (decision === "call_again" || decision === "next_round" || decision === "rejected") {
    return decision;
  }
  return "";
}

function mapCallResponse(row: Record<string, unknown>): CallResponse {
  const duration = row.duration_seconds;
  let result = null;
  try {
    result = parseScreeningResult(JSON.parse(String(row.result_json || "null")));
  } catch {
    result = null;
  }
  return {
    id: String(row.id),
    batchId: String(row.batch_id ?? ""),
    candidateId: String(row.candidate_id ?? ""),
    calleCallId: String(row.calle_call_id ?? ""),
    status: parseCallStatus(row.status),
    startedAt: String(row.started_at ?? ""),
    endedAt: String(row.ended_at ?? ""),
    durationSeconds: Number.isFinite(Number(duration)) ? Number(duration) : null,
    result,
    summary: String(row.summary ?? ""),
    score:
      row.score == null || row.score === "" || !Number.isFinite(Number(row.score))
        ? null
        : Number(row.score),
    passScore: passScore(),
    decision: parseDecision(row.decision),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapCandidate(row: Record<string, unknown>, callResponse: CallResponse | null = null): Candidate {
  return {
    id: String(row.id),
    batchId: String(row.batch_id ?? ""),
    name: String(row.name),
    phone: String(row.phone),
    consent: Number(row.consent) === 1,
    resumeUrl: String(row.resume_url ?? ""),
    resumeText: String(row.resume_text ?? ""),
    resumeFetchedAt: String(row.resume_fetched_at ?? ""),
    resumeFetchError: String(row.resume_fetch_error ?? ""),
    callPrompt: String(row.call_prompt ?? ""),
    jobRole: String(row.job_role ?? ""),
    sourceFilename: String(row.source_filename ?? ""),
    createdAt: String(row.created_at),
    active: Number(row.active ?? 1) === 1,
    callStatus: parseCallStatus(row.call_status),
    calleCallId: String(row.calle_call_id ?? ""),
    callAttempt: Number(row.call_attempt ?? 0),
    callResponse,
  };
}

function mapBatch(row: Record<string, unknown>): Batch {
  return {
    id: String(row.id),
    filename: String(row.filename),
    jobRole: String(row.job_role ?? ""),
    systemPrompt: String(row.system_prompt ?? ""),
    scoreConfig: parseScoreConfig(row.score_criteria),
    scoreCriteriaSaved: String(row.score_criteria ?? "").trim() !== "",
    createdAt: String(row.created_at),
    candidateCount: Number(row.candidate_count ?? 0),
    readyCount: Number(row.ready_count ?? 0),
    consentedCount: Number(row.consented_count ?? 0),
    queuedCount: Number(row.queued_count ?? 0),
    active: Number(row.active ?? 1) === 1,
  };
}

const BATCH_SELECT = `
  SELECT
    b.id,
    b.filename,
    b.job_role,
    b.system_prompt,
    b.score_criteria,
    b.created_at,
    b.active,
    COUNT(c.id) AS candidate_count,
    COALESCE(SUM(CASE WHEN c.consent = 1 THEN 1 ELSE 0 END), 0) AS consented_count,
    COALESCE(SUM(CASE WHEN c.consent = 1 AND c.resume_text != '' AND c.call_prompt != '' THEN 1 ELSE 0 END), 0) AS ready_count,
    COALESCE(SUM(CASE WHEN c.call_status IN ('queued', 'calling', 'talking') THEN 1 ELSE 0 END), 0) AS queued_count
  FROM batches b
  LEFT JOIN candidates c ON c.batch_id = b.id AND c.active = b.active
`;

const CANDIDATE_SELECT = `id, batch_id, name, phone, consent, resume_url, resume_text, resume_fetched_at, resume_fetch_error, call_prompt, job_role, source_filename, created_at, call_status, calle_call_id, call_attempt, active`;

export async function listBatches(): Promise<{ batches: Batch[]; inactiveBatches: Batch[] }> {
  const client = getClient();
  await migrate(client);
  const result = await client.execute(`${BATCH_SELECT} GROUP BY b.id ORDER BY b.created_at DESC`);
  const all = result.rows.map((row) => mapBatch(row as Record<string, unknown>));
  return {
    batches: all.filter((row) => row.active),
    inactiveBatches: all.filter((row) => !row.active),
  };
}

export async function getBatch(id: string): Promise<{ batch: Batch; candidates: Candidate[] } | null> {
  const client = getClient();
  await migrate(client);
  const batchResult = await client.execute({
    sql: `${BATCH_SELECT} WHERE b.id = ? GROUP BY b.id`,
    args: [id],
  });
  const batchRow = batchResult.rows[0];
  if (!batchRow) return null;
  const batch = mapBatch(batchRow as Record<string, unknown>);

  const people = await client.execute({
    sql: `SELECT ${CANDIDATE_SELECT}
          FROM candidates
          WHERE batch_id = ? AND active = ?
          ORDER BY name COLLATE NOCASE`,
    args: [id, batch.active ? 1 : 0],
  });
  const responses = await latestCallResponses(id);

  return {
    batch,
    candidates: people.rows.map((row) => {
      const candidate = mapCandidate(row as Record<string, unknown>);
      const response = responses.get(candidate.id) ?? null;
      return {
        ...candidate,
        callResponse: response
          ? { ...response, passScore: batch.scoreConfig.passScore }
          : null,
      };
    }),
  };
}

export async function createBatchWithCandidates(
  rows: CandidateInput[],
  filename: string,
): Promise<{ batch: Batch; candidates: Candidate[] }> {
  const client = getClient();
  await migrate(client);

  const batchId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const jobRole = rows.find((row) => row.jobRole)?.jobRole ?? "";
  await client.execute({
    sql: "INSERT INTO batches (id, filename, created_at, job_role) VALUES (?, ?, ?, ?)",
    args: [batchId, filename, createdAt, jobRole],
  });

  const inserted: Candidate[] = [];
  for (const row of rows) {
    const id = crypto.randomUUID();
    const args: InValue[] = [
      id,
      batchId,
      row.name,
      row.phone,
      row.consent ? 1 : 0,
      row.resumeUrl,
      row.jobRole || jobRole,
      filename,
      createdAt,
      "not_called",
    ];
    await client.execute({
      sql: `INSERT INTO candidates (
              id, batch_id, name, phone, consent, resume_url, job_role, source_filename, created_at, call_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args,
    });
    inserted.push({
      id,
      batchId,
      name: row.name,
      phone: row.phone,
      consent: row.consent,
      resumeUrl: row.resumeUrl,
      resumeText: "",
      resumeFetchedAt: "",
      resumeFetchError: "",
      callPrompt: "",
      jobRole: row.jobRole || jobRole,
      sourceFilename: filename,
      createdAt,
      active: true,
      callStatus: "not_called",
      calleCallId: "",
      callAttempt: 0,
      callResponse: null,
    });
  }

  const batch = (await getBatch(batchId))?.batch;
  if (!batch) {
    throw new Error("Batch was created but could not be loaded.");
  }
  return { batch, candidates: inserted };
}

export async function createDemoBatch(input: {
  phone: string;
  name?: string;
  jobRole?: string;
}): Promise<{ batch: Batch; candidates: Candidate[] }> {
  const client = getClient();
  await migrate(client);

  const phone = normalizePhone(input.phone);
  if (!isValidE164(phone)) {
    throw new Error("Phone needs a country code, e.g. +14155550123.");
  }

  const name = (input.name ?? DEMO_NAME).trim() || DEMO_NAME;
  const jobRole = (input.jobRole ?? DEMO_JOB_ROLE).trim() || DEMO_JOB_ROLE;
  const batchId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await client.execute({
    sql: "INSERT INTO batches (id, filename, created_at, job_role, score_criteria) VALUES (?, ?, ?, ?, ?)",
    args: [batchId, DEMO_FILENAME, createdAt, jobRole, JSON.stringify(DEFAULT_SCORE_CONFIG)],
  });
  await client.execute({
    sql: `INSERT INTO candidates (
            id, batch_id, name, phone, consent, resume_url, resume_text, resume_fetched_at,
            call_prompt, job_role, source_filename, created_at, call_status, active
          ) VALUES (?, ?, ?, ?, 1, '', ?, ?, ?, ?, ?, ?, 'not_called', 1)`,
    args: [
      candidateId,
      batchId,
      name,
      phone,
      DEMO_RESUME_TEXT,
      createdAt,
      DEMO_CALL_PROMPT,
      jobRole,
      DEMO_FILENAME,
      createdAt,
    ],
  });

  const detail = await getBatch(batchId);
  if (!detail) {
    throw new Error("Judge test batch was created but could not be loaded.");
  }
  return detail;
}

export async function loadCandidate(batchId: string, candidateId: string): Promise<Candidate> {
  const client = getClient();
  await migrate(client);
  const found = await client.execute({
    sql: `SELECT ${CANDIDATE_SELECT} FROM candidates WHERE id = ? AND batch_id = ?`,
    args: [candidateId, batchId],
  });
  const row = found.rows[0];
  if (!row) {
    throw new Error("Candidate not found in this Excel batch.");
  }
  const candidate = mapCandidate(row as Record<string, unknown>);
  const responses = await latestCallResponses(batchId);
  const config = await loadBatchScoreConfig(batchId);
  const response = responses.get(candidate.id) ?? null;
  return {
    ...candidate,
    callResponse: response ? { ...response, passScore: config.passScore } : null,
  };
}

async function loadBatchScoreConfig(batchId: string) {
  const client = getClient();
  const found = await client.execute({
    sql: "SELECT score_criteria FROM batches WHERE id = ?",
    args: [batchId],
  });
  return parseScoreConfig(found.rows[0]?.score_criteria);
}

export async function requireActiveBatch(batchId: string): Promise<void> {
  const detail = await getBatch(batchId);
  if (!detail) throw new Error("Excel batch not found.");
  if (!detail.batch.active) throw new Error("This Excel batch is inactive. Restore it first.");
}

async function latestCallResponses(batchId: string): Promise<Map<string, CallResponse>> {
  const client = getClient();
  const found = await client.execute({
    sql: `SELECT id, batch_id, candidate_id, calle_call_id, status, started_at, ended_at, duration_seconds, result_json, summary, score, decision, created_at
          FROM call_responses
          WHERE batch_id = ?
          ORDER BY created_at DESC`,
    args: [batchId],
  });
  const latest = new Map<string, CallResponse>();
  for (const row of found.rows) {
    const mapped = mapCallResponse(row as Record<string, unknown>);
    if (!latest.has(mapped.candidateId)) {
      latest.set(mapped.candidateId, mapped);
    }
  }
  return latest;
}

export async function markCandidateQueued(batchId: string, candidateId: string): Promise<Candidate> {
  const client = getClient();
  await client.execute({
    sql: "UPDATE candidates SET call_status = 'queued' WHERE id = ? AND batch_id = ?",
    args: [candidateId, batchId],
  });
  return loadCandidate(batchId, candidateId);
}

export async function saveDialledCall(input: {
  batchId: string;
  candidateId: string;
  calleCallId: string;
  attempt: number;
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number | null;
  result?: unknown;
  raw: unknown;
}): Promise<Candidate> {
  const client = getClient();
  const now = new Date().toISOString();
  const responseId = crypto.randomUUID();
  const endedAt = input.endedAt ?? "";
  const resultJson = input.result ? JSON.stringify(input.result) : "";
  await client.execute({
    sql: `UPDATE candidates
          SET call_status = ?, calle_call_id = ?, call_attempt = ?
          WHERE id = ? AND batch_id = ?`,
    args: [input.status, input.calleCallId, input.attempt, input.candidateId, input.batchId],
  });
  await client.execute({
    sql: `INSERT INTO call_responses (
            id, batch_id, candidate_id, calle_call_id, status, started_at, ended_at, duration_seconds, result_json, raw_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      responseId,
      input.batchId,
      input.candidateId,
      input.calleCallId,
      input.status,
      input.startedAt,
      endedAt,
      input.durationSeconds ?? null,
      resultJson,
      JSON.stringify(input.raw ?? {}),
      now,
    ],
  });
  return loadCandidate(input.batchId, input.candidateId);
}

export async function saveCallProgress(input: {
  batchId: string;
  candidateId: string;
  calleCallId: string;
  status: CallStatus;
  startedAt: string;
  endedAt: string;
  durationSeconds: number | null;
  result: unknown;
  raw: unknown;
}): Promise<Candidate> {
  const client = getClient();
  await client.execute({
    sql: `UPDATE candidates SET call_status = ? WHERE id = ? AND batch_id = ?`,
    args: [input.status, input.candidateId, input.batchId],
  });
  const existing = await client.execute({
    sql: `SELECT id FROM call_responses WHERE calle_call_id = ? AND candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [input.calleCallId, input.candidateId],
  });
  const resultJson = input.result ? JSON.stringify(input.result) : "";
  const rawJson = JSON.stringify(input.raw ?? {});
  const duration = input.durationSeconds;
  if (existing.rows[0]) {
    await client.execute({
      sql: `UPDATE call_responses
            SET status = ?, started_at = ?, ended_at = ?, duration_seconds = ?, result_json = ?, raw_json = ?
            WHERE id = ?`,
      args: [
        input.status,
        input.startedAt,
        input.endedAt,
        duration,
        resultJson,
        rawJson,
        String(existing.rows[0].id),
      ],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO call_responses (
              id, batch_id, candidate_id, calle_call_id, status, started_at, ended_at, duration_seconds, result_json, raw_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        input.batchId,
        input.candidateId,
        input.calleCallId,
        input.status,
        input.startedAt,
        input.endedAt,
        duration,
        resultJson,
        rawJson,
        new Date().toISOString(),
      ],
    });
  }
  return loadCandidate(input.batchId, input.candidateId);
}

export async function saveCallVerdict(
  responseId: string,
  input: { summary: string; score: number; decision: RecruiterDecision },
): Promise<void> {
  const client = getClient();
  await client.execute({
    sql: "UPDATE call_responses SET summary = ?, score = ?, decision = ? WHERE id = ? AND score IS NULL",
    args: [input.summary.trim(), input.score, input.decision, responseId],
  });
}

export async function setCallDecision(
  batchId: string,
  candidateId: string,
  decision: RecruiterDecision,
): Promise<Candidate> {
  await requireActiveBatch(batchId);
  const candidate = await loadCandidate(batchId, candidateId);
  const responseId = candidate.callResponse?.id;
  if (!responseId) {
    throw new Error("This person has no call result yet.");
  }
  const client = getClient();
  await client.execute({
    sql: "UPDATE call_responses SET decision = ? WHERE id = ?",
    args: [decision, responseId],
  });

  if (decision === "call_again" && shouldRewriteFollowUpPrompt(candidate.callResponse?.result ?? null)) {
    try {
      const followUp = await generateFollowUpCallPrompt({
        name: candidate.name,
        jobRole: candidate.jobRole,
        resumeText: candidate.resumeText,
        previousPrompt: candidate.callPrompt,
        result: candidate.callResponse?.result ?? null,
        summary: candidate.callResponse?.summary ?? "",
      });
      await client.execute({
        sql: "UPDATE candidates SET call_prompt = ? WHERE id = ? AND batch_id = ?",
        args: [followUp, candidateId, batchId],
      });
    } catch {
      // Keep the original prompt if Gemini cannot rewrite it.
    }
  }

  return loadCandidate(batchId, candidateId);
}

export function shouldRewriteFollowUpPrompt(result: { good_time?: string; end_reason?: string } | null) {
  if (!result) return false;
  if (result.good_time === "callback" || result.good_time === "declined") return false;
  if (result.end_reason !== "completed") return false;
  return true;
}

export async function markCallFailed(batchId: string, candidateId: string, message: string): Promise<Candidate> {
  const client = getClient();
  await client.execute({
    sql: "UPDATE candidates SET call_status = 'failed' WHERE id = ? AND batch_id = ?",
    args: [candidateId, batchId],
  });
  await client.execute({
    sql: `INSERT INTO call_responses (
            id, batch_id, candidate_id, calle_call_id, status, started_at, ended_at, duration_seconds, result_json, raw_json, created_at
          ) VALUES (?, ?, ?, '', 'failed', '', ?, NULL, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      batchId,
      candidateId,
      new Date().toISOString(),
      JSON.stringify({ recruiter_follow_up: message, end_reason: "failed" }),
      JSON.stringify({ error: message }),
      new Date().toISOString(),
    ],
  });
  return loadCandidate(batchId, candidateId);
}

export async function prepareCandidatePrompt(
  batchId: string,
  candidateId: string,
): Promise<{ source: PromptSource }> {
  await requireActiveBatch(batchId);
  const candidate = await loadCandidate(batchId, candidateId);
  if (!candidate.active) {
    throw new Error("This candidate is inactive.");
  }
  if (!candidate.resumeText) {
    throw new Error("Prepare the resume before writing a call prompt.");
  }

  const detail = await getBatch(batchId);
  const { prompt, source } = await generateCallPrompt(
    candidate.name,
    candidate.resumeText,
    candidate.jobRole || detail?.batch.jobRole || "",
  );
  const client = getClient();
  await client.execute({
    sql: "UPDATE candidates SET call_prompt = ? WHERE id = ? AND batch_id = ?",
    args: [prompt, candidateId, batchId],
  });
  return { source };
}

export async function prepareBatchPrompts(
  batchId: string,
): Promise<{ prepared: number; failed: number; skipped: number }> {
  const detail = await getBatch(batchId);
  if (!detail) {
    throw new Error("Excel batch not found.");
  }

  let prepared = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of detail.candidates) {
    if (!row.resumeText || row.callPrompt) {
      skipped += 1;
      continue;
    }
    try {
      await prepareCandidatePrompt(batchId, row.id);
      prepared += 1;
    } catch {
      failed += 1;
    }
  }
  return { prepared, failed, skipped };
}

export async function prepareCandidateResume(batchId: string, candidateId: string): Promise<Candidate> {
  await requireActiveBatch(batchId);
  const candidate = await loadCandidate(batchId, candidateId);
  if (!candidate.active) {
    throw new Error("This candidate is inactive.");
  }
  if (!candidate.resumeUrl) {
    throw new Error("This candidate has no resume link.");
  }

  const client = getClient();
  try {
    const { text } = await readResumeTextFromUrl(candidate.resumeUrl);
    const fetchedAt = new Date().toISOString();
    await client.execute({
      sql: `UPDATE candidates
            SET resume_text = ?, resume_fetched_at = ?, resume_fetch_error = '', call_prompt = ''
            WHERE id = ? AND batch_id = ?`,
      args: [text, fetchedAt, candidateId, batchId],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that resume link.";
    await client.execute({
      sql: `UPDATE candidates
            SET resume_text = '', resume_fetched_at = '', resume_fetch_error = ?, call_prompt = ''
            WHERE id = ? AND batch_id = ?`,
      args: [message, candidateId, batchId],
    });
    throw new Error(message);
  }
  return writeCallPromptAfterResume(batchId, candidateId);
}

async function writeCallPromptAfterResume(batchId: string, candidateId: string): Promise<Candidate> {
  try {
    await prepareCandidatePrompt(batchId, candidateId);
    return loadCandidate(batchId, candidateId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini could not write the call script.";
    throw new Error(`Resume saved, but the call script was not written. ${message}`);
  }
}

export async function prepareBatchResumes(
  batchId: string,
): Promise<{ prepared: number; failed: number; skipped: number; promptFailed: number }> {
  const detail = await getBatch(batchId);
  if (!detail) {
    throw new Error("Excel batch not found.");
  }

  let prepared = 0;
  let failed = 0;
  let skipped = 0;
  let promptFailed = 0;
  for (const row of detail.candidates) {
    if (!row.resumeUrl) {
      skipped += 1;
      continue;
    }
    if (row.resumeText && row.callPrompt) {
      skipped += 1;
      continue;
    }
    try {
      if (!row.resumeText) {
        await prepareCandidateResume(batchId, row.id);
      } else {
        await prepareCandidatePrompt(batchId, row.id);
      }
      prepared += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("Resume saved, but the call script was not written.")) {
        promptFailed += 1;
        prepared += 1;
      } else if (row.resumeText && !row.callPrompt) {
        promptFailed += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { prepared, failed, skipped, promptFailed };
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function updateCandidate(
  batchId: string,
  candidateId: string,
  patch: { name?: string; phone?: string; resumeUrl?: string; consent?: boolean; jobRole?: string },
): Promise<Candidate> {
  await requireActiveBatch(batchId);
  const current = await loadCandidate(batchId, candidateId);
  if (!current.active) {
    throw new Error("This candidate is inactive.");
  }

  const name = (patch.name ?? current.name).trim();
  const requestedPhone = typeof patch.phone === "string" ? normalizePhone(patch.phone) : "";
  const phone = !requestedPhone || looksMasked(requestedPhone) ? current.phone : requestedPhone;
  const resumeUrl = (patch.resumeUrl ?? current.resumeUrl).trim();
  const jobRole = (patch.jobRole ?? current.jobRole).trim();
  const consent = patch.consent ?? current.consent;
  if (!name || !phone) {
    throw new Error("Name and phone are both required.");
  }
  if (!isValidE164(phone)) {
    throw new Error("Phone needs a country code, e.g. +14155550123.");
  }

  const linkChanged = resumeUrl !== current.resumeUrl;
  const roleChanged = jobRole !== current.jobRole;
  const nameChanged = name !== current.name;
  const rewritePrompt = !linkChanged && (roleChanged || nameChanged);
  const clearPrompt = linkChanged || roleChanged || nameChanged;
  const client = getClient();
  await client.execute({
    sql: `UPDATE candidates
          SET name = ?, phone = ?, consent = ?, resume_url = ?, job_role = ?,
              resume_text = CASE WHEN ? = 1 THEN '' ELSE resume_text END,
              resume_fetched_at = CASE WHEN ? = 1 THEN '' ELSE resume_fetched_at END,
              resume_fetch_error = CASE WHEN ? = 1 THEN '' ELSE resume_fetch_error END,
              call_prompt = CASE WHEN ? = 1 THEN '' ELSE call_prompt END
          WHERE id = ? AND batch_id = ?`,
    args: [
      name,
      phone,
      consent ? 1 : 0,
      resumeUrl,
      jobRole,
      linkChanged ? 1 : 0,
      linkChanged ? 1 : 0,
      linkChanged ? 1 : 0,
      clearPrompt ? 1 : 0,
      candidateId,
      batchId,
    ],
  });
  const updated = await loadCandidate(batchId, candidateId);
  if (rewritePrompt && updated.resumeText) {
    try {
      await prepareCandidatePrompt(batchId, candidateId);
      return loadCandidate(batchId, candidateId);
    } catch {
      return updated;
    }
  }
  return updated;
}

export async function updateBatchFromWorkbook(
  batchId: string,
  rows: CandidateInput[],
  filename: string,
): Promise<{ updated: number; inserted: number }> {
  await requireActiveBatch(batchId);
  const detail = await getBatch(batchId);
  if (!detail) throw new Error("Excel batch not found.");

  const unused = [...detail.candidates];
  let updated = 0;
  let inserted = 0;
  const client = getClient();
  const createdAt = new Date().toISOString();

  await client.execute({
    sql: "UPDATE batches SET filename = ?, job_role = ? WHERE id = ?",
    args: [filename, rows.find((row) => row.jobRole)?.jobRole || detail.batch.jobRole, batchId],
  });

  for (const row of rows) {
    const matchIndex = unused.findIndex((person) => normalizeName(person.name) === normalizeName(row.name));
    const phoneIndex =
      matchIndex >= 0
        ? matchIndex
        : unused.findIndex((person) => normalizePhone(person.phone) === normalizePhone(row.phone));
    if (phoneIndex >= 0) {
      const existing = unused.splice(phoneIndex, 1)[0];
      await updateCandidate(batchId, existing.id, {
        name: row.name,
        phone: row.phone,
        resumeUrl: row.resumeUrl,
        consent: row.consent,
        jobRole: row.jobRole,
      });
      await client.execute({
        sql: "UPDATE candidates SET source_filename = ? WHERE id = ? AND batch_id = ?",
        args: [filename, existing.id, batchId],
      });
      updated += 1;
      continue;
    }

    const id = crypto.randomUUID();
    await client.execute({
      sql: `INSERT INTO candidates (
              id, batch_id, name, phone, consent, resume_url, job_role, source_filename, created_at, call_status, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_called', 1)`,
      args: [id, batchId, row.name, row.phone, row.consent ? 1 : 0, row.resumeUrl, row.jobRole, filename, createdAt],
    });
    inserted += 1;
  }

  return { updated, inserted };
}

export async function setBatchActive(id: string, active: boolean): Promise<boolean> {
  const client = getClient();
  await migrate(client);
  const existing = await client.execute({
    sql: "SELECT id FROM batches WHERE id = ?",
    args: [id],
  });
  if (!existing.rows[0]) return false;
  const flag = active ? 1 : 0;
  await client.execute({
    sql: "UPDATE batches SET active = ? WHERE id = ?",
    args: [flag, id],
  });
  await client.execute({
    sql: "UPDATE candidates SET active = ? WHERE batch_id = ?",
    args: [flag, id],
  });
  return true;
}

export async function setBatchJobRole(id: string, jobRole: string): Promise<boolean> {
  await requireActiveBatch(id);
  const client = getClient();
  const role = jobRole.trim();
  await client.execute({
    sql: "UPDATE batches SET job_role = ? WHERE id = ?",
    args: [role, id],
  });
  await client.execute({
    sql: "UPDATE candidates SET job_role = ?, call_prompt = '' WHERE batch_id = ?",
    args: [role, id],
  });
  await prepareBatchPrompts(id);
  return true;
}

export async function setBatchSystemPrompt(id: string, systemPrompt: string): Promise<boolean> {
  await requireActiveBatch(id);
  const client = getClient();
  await client.execute({
    sql: "UPDATE batches SET system_prompt = ? WHERE id = ?",
    args: [systemPrompt.trim(), id],
  });
  await client.execute({
    sql: "UPDATE candidates SET call_prompt = '' WHERE batch_id = ?",
    args: [id],
  });
  return true;
}

export async function setBatchScoreConfig(id: string, config: ReturnType<typeof parseScoreConfig>): Promise<boolean> {
  await requireActiveBatch(id);
  const client = getClient();
  await client.execute({
    sql: "UPDATE batches SET score_criteria = ? WHERE id = ?",
    args: [JSON.stringify(config), id],
  });
  return true;
}

export async function deactivateAll(): Promise<{ batches: number; candidates: number }> {
  const client = getClient();
  await migrate(client);
  const people = await client.execute("SELECT COUNT(*) AS n FROM candidates WHERE active = 1");
  const files = await client.execute("SELECT COUNT(*) AS n FROM batches WHERE active = 1");
  await client.execute("UPDATE candidates SET active = 0 WHERE active = 1");
  await client.execute("UPDATE batches SET active = 0 WHERE active = 1");
  return {
    candidates: Number(people.rows[0]?.n ?? 0),
    batches: Number(files.rows[0]?.n ?? 0),
  };
}
