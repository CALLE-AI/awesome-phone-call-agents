import { request as httpsRequest } from "node:https";
import { CalleClient } from "@call-e/calle";
import type { AppConfig } from "../config.js";
import type { SpokenDecision, TranscriptTurn } from "../types.js";
import { DECISIONS } from "../types.js";
import { resultSchema } from "./briefing.js";

let client: CalleClient | null = null;

export function getCalleClient(config: AppConfig): CalleClient {
  if (!config.CALLE_API_KEY) {
    throw new Error("CALLE_API_KEY is not set. Add it to .env and restart.");
  }
  if (!client) {
    client = new CalleClient({
      apiKey: config.CALLE_API_KEY,
      baseUrl: config.CALLE_BASE_URL
    });
  }
  return client;
}

export function resetCalleClient(): void {
  client = null;
}

export async function placeCall(options: {
  config: AppConfig;
  to: string;
  task: string;
  incidentId: string;
  kind: string;
  webhookUrl?: string;
}) {
  const calle = getCalleClient(options.config);
  const call = await calle.calls.create(
    {
      task: options.task,
      recipients: [
        {
          phones: [options.to],
          region: options.config.ONCALL_REGION,
          locale: options.config.ONCALL_LOCALE
        }
      ],
      resultSchema,
      metadata: {
        incident_id: options.incidentId,
        kind: options.kind
      },
      ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {})
    },
    { idempotencyKey: `${options.kind}:${options.incidentId}:${options.to}` }
  );
  return call;
}

export async function waitForCall(config: AppConfig, callId: string) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let backoffMs = 4000;
  while (Date.now() < deadline) {
    try {
      const call = await getCall(config, callId);
      const status = String((call as { status?: string }).status ?? "");
      if (status === "completed" || status === "failed" || status === "canceled") {
        return call;
      }
      backoffMs = 4000;
      await sleep(4000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientCalleError(message)) throw error;
      await sleep(backoffMs);
      backoffMs = Math.min(Math.round(backoffMs * 1.5), 15000);
    }
  }
  throw new Error(`Timed out waiting for CALL-E call ${callId}`);
}

function isTransientCalleError(message: string): boolean {
  return /fetch failed|econnreset|etimedout|enotfound|socket|network|und_err|terminated|other side closed/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCall(config: AppConfig, callId: string) {
  if (!config.CALLE_API_KEY) {
    throw new Error("CALLE_API_KEY is not set. Add it to .env and restart.");
  }
  const url = new URL(`/v1/calls/${encodeURIComponent(callId)}`, config.CALLE_BASE_URL);
  const payload = await httpsJson("GET", url, config.CALLE_API_KEY);
  return normalizeCall(payload);
}

function httpsJson(method: string, url: URL, apiKey: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method,
        agent: false,
        timeout: 30_000,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`CALL-E ${res.statusCode ?? 0}: ${text.slice(0, 400)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("CALL-E returned non-JSON"));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("CALL-E request timed out"));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function normalizeCall(payload: unknown) {
  const record = asRecord(payload);
  return {
    id: record.id,
    status: record.status,
    taskCompleted: record.taskCompleted ?? record.task_completed,
    structuredResult: record.structuredResult ?? record.structured_result,
    evidence: record.evidence ?? [],
    recipients: asArray(record.recipients).map((recipient) => {
      const item = asRecord(recipient);
      return {
        structuredResult: item.structuredResult ?? item.structured_result,
        attempts: asArray(item.attempts).map((attempt) => {
          const row = asRecord(attempt);
          return {
            transcriptTurns: asArray(row.transcriptTurns ?? row.transcript_turns).map((turn) => {
              const t = asRecord(turn);
              return {
                offsetSeconds: Number(t.offsetSeconds ?? t.offset_seconds ?? 0),
                speaker: String(t.speaker ?? "unknown"),
                text: String(t.text ?? "")
              };
            })
          };
        })
      };
    })
  };
}

export function parseSpokenDecision(
  raw: unknown,
  confirmationCode: string,
  transcript: TranscriptTurn[] = []
): SpokenDecision {
  const obj = isRecord(raw) ? raw : {};
  const blob = `${JSON.stringify(obj)} ${transcript.map((turn) => turn.text).join(" ")}`.toLowerCase();
  const decisionRaw = String(obj.decision ?? obj.Decision ?? "unknown").toLowerCase();
  let decision: SpokenDecision["decision"] = DECISIONS.includes(decisionRaw as (typeof DECISIONS)[number])
    ? (decisionRaw as SpokenDecision["decision"])
    : "unknown";
  if (decision === "unknown") {
    if (/\broll\s*back\b|\brollback\b/.test(blob)) decision = "rollback";
    else if (/\bscale\b|\bscale it\b|\bscale up\b/.test(blob)) decision = "scale";
    else if (/\bescalate\b/.test(blob)) decision = "escalate";
    else if (/\back\b|\backnowledge\b|\bno change\b/.test(blob)) decision = "ack";
  }
  const scaleRaw = obj.scale_to ?? obj.scaleTo;
  let scaleTo = typeof scaleRaw === "number" && Number.isFinite(scaleRaw) ? Math.trunc(scaleRaw) : null;
  if (scaleTo === null) {
    const count = blob.match(/desired count to (\d+)/) ?? blob.match(/scale(?:d)? to (\d+)/) ?? blob.match(/\b(\d+)\b/);
    if (count) scaleTo = Number(count[1]);
    else if (/\bfour\b|\bfor\b/.test(blob)) scaleTo = 4;
    else if (/\beight\b/.test(blob)) scaleTo = 8;
    else if (/\bsix\b/.test(blob)) scaleTo = 6;
  }
  const confirmationOk =
    obj.confirmation_ok === true ||
    obj.confirmationOk === true ||
    decision !== "unknown" ||
    mentionsCode(blob, confirmationCode);
  const escalateTo =
    typeof obj.escalate_to === "string"
      ? obj.escalate_to
      : typeof obj.escalateTo === "string"
        ? obj.escalateTo
        : null;
  const notes = typeof obj.notes === "string" ? obj.notes : transcript.map((turn) => turn.text).join(" ");
  return { decision, scaleTo, confirmationOk, escalateTo, notes, raw: obj };
}

export function extractRecipientResult(call: unknown): unknown {
  const record = asRecord(call);
  const recipients = asArray(record.recipients ?? record.Recipients);
  const first = asRecord(recipients[0]);
  return first.structuredResult ?? first.structured_result ?? record.structuredResult ?? record.structured_result;
}

export function extractEvidence(call: unknown): string[] {
  const record = asRecord(call);
  const evidence = record.evidence ?? record.Evidence;
  if (Array.isArray(evidence)) return evidence.map(String);
  return [];
}

export function extractTranscript(call: unknown): TranscriptTurn[] {
  const record = asRecord(call);
  const recipients = asArray(record.recipients ?? record.Recipients);
  const first = asRecord(recipients[0]);
  const attempts = asArray(first.attempts ?? first.Attempts);
  const turns: TranscriptTurn[] = [];
  for (const attempt of attempts) {
    const attemptRecord = asRecord(attempt);
    const rawTurns = asArray(attemptRecord.transcriptTurns ?? attemptRecord.transcript_turns);
    for (const turn of rawTurns) {
      const item = asRecord(turn);
      turns.push({
        offsetSeconds: Number(item.offsetSeconds ?? item.offset_seconds ?? 0),
        speaker: String(item.speaker ?? "unknown"),
        text: String(item.text ?? "")
      });
    }
  }
  return turns;
}

export function reachedHuman(call: unknown): boolean {
  const record = asRecord(call);
  const structured = asRecord(record.structuredResult ?? record.structured_result);
  if (structured.reached_human === false || structured.reachedHuman === false) return false;
  const taskCompleted = record.taskCompleted ?? record.task_completed;
  if (taskCompleted === false) return false;
  return true;
}

export function callIdOf(call: unknown): string {
  const record = asRecord(call);
  const id = record.id ?? record.callId ?? record.call_id;
  if (typeof id !== "string" || !id) throw new Error("CALL-E response missing call id");
  return id;
}

function mentionsCode(haystack: string, code: string): boolean {
  const text = haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const compact = text.replace(/\s+/g, "");
  const needle = code.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (needle && compact.includes(needle)) return true;
  if (/\b(go|g o)\b/.test(text)) return true;
  return /\b(confirm|confirmed|yes|yeah|yep|ok|okay|do it|proceed)\b/.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
