// File: src/lib/calle.ts
// The ONLY module that imports @call-e/calle. All SDK reality is quarantined here.
//
// SDK PROBE OUTCOME (@call-e/calle@0.7.0, verified against installed dist/*.d.ts):
//   - client.calls.createAndWait(input, { idempotencyKey, ... })  [not create+wait separately]
//       input is camelCase: { task, recipients:[{phones,locale,region}], resultSchema,
//       recipientResultSchema, metadata, webhookUrl }  (ARCHITECTURE assumed snake_case).
//       LIVE CONSTRAINT (verified 2026-09-14): the SDK/OpenAPI expose resultSchema +
//       recipientResultSchema, but the current API tier returns 400 "<field> is not
//       supported" for both. We omit them and derive results from returned text (extract.ts).
//   - client.calls.get(callId) -> Call
//   - client.calls.listEvents(callId) -> { data: DeveloperEvent[], nextCursor }
//       (ARCHITECTURE assumed client.calls.events()).
//   - client.goals.runAndWait({ goalId, phone, variables, idempotencyKey }) -> GoalRun
//       (ARCHITECTURE assumed goals.run(goalId, {inputs, idempotencyKey}); real Goals are
//        single-phone per run and own their schemas, so multi-recipient goals are N/A).
// The real `Call` object is camelCase and has no recipient `.name`; we map it into
// GoodFaith's internal snake_case `CallTask` (calle-types.ts) so the deterministic core
// is unaffected. Mock path is byte-identical to the fixture and requires zero network.
import "server-only";
import { CalleClient, type Call, type CallRecipient as SdkRecipient } from "@call-e/calle";
import { env, isLive } from "@/lib/env";
import { buildTaskPrompt } from "@/lib/schemas";
import { extractRecipientResult } from "@/lib/extract";
import { loadFixture } from "@/lib/fixtures";
import type {
  CallTask,
  CallEvent,
  CallRecipient,
  CallAttempt,
  CompletionConfidence,
  CallStatus,
} from "@/lib/calle-types";

export interface Clinic {
  name: string;
  phone: string; // E.164
}

export interface CreateQuoteInput {
  procedure: string;
  code: string;
  clinics: Clinic[];
  rfqId: string;
}

export interface CreateQuoteResult {
  callId: string;
  mode: "mock" | "live";
  task: CallTask; // present immediately in mock; in live, terminal task from createAndWait
}

function client(): CalleClient {
  return new CalleClient({ apiKey: env.calleApiKey()!, baseUrl: env.calleBaseUrl() });
}

export { isLive };

// ---- live -> internal shape mapping (adapter) ----

function mapSpeaker(speaker: string): string {
  if (speaker === "bot") return "agent";
  if (speaker === "user") return "clinic";
  return speaker;
}

function mapRecipientStatus(status: string): CallStatus {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "skipped":
      return "canceled";
    default:
      return "queued";
  }
}

function mapConfidence(c: Call["completionConfidence"]): CompletionConfidence | undefined {
  if (!c) return undefined;
  return { score: c.score, label: c.label };
}

function mapRecipient(rec: SdkRecipient, nameByPhone: Map<string, string>, code?: string): CallRecipient {
  const phone = rec.phones?.[0];
  const attempts: CallAttempt[] = (rec.attempts ?? []).map((a) => ({
    status: a.status,
    started_at: a.startedAt ?? undefined,
    ended_at: a.completedAt ?? undefined,
    transcript_turns: (a.transcriptTurns ?? []).map((t) => ({
      offset_seconds: t.offset_seconds ?? 0,
      speaker: mapSpeaker(t.speaker),
      text: t.text,
    })),
  }));
  const mapped: CallRecipient = {
    phone,
    name: (phone && nameByPhone.get(phone)) || phone || "Unknown clinic",
    status: mapRecipientStatus(rec.status),
    summary: rec.summary ?? undefined,
    // The current CALL-E tier rejects result/recipient JSON schemas (see extract.ts header),
    // so there is no server-side structured result. We derive it deterministically from the
    // recipient's summary + transcript, honoring the no-fabricated-quotes invariant.
    structured_result: null,
    attempts,
  };
  mapped.structured_result = extractRecipientResult(mapped, code);
  return mapped;
}

function mapCallToTask(call: Call, input: CreateQuoteInput): CallTask {
  const nameByPhone = new Map<string, string>();
  for (const c of input.clinics) nameByPhone.set(c.phone, c.name);

  return {
    id: call.id,
    status: (call.status as CallStatus) ?? "completed",
    structured_result:
      (call.structuredResult as CallTask["structured_result"]) ?? null,
    summary: call.summary ?? undefined,
    task_completed: call.taskCompleted ?? false,
    completion_confidence: mapConfidence(call.completionConfidence),
    evidence: call.evidence ?? [],
    recipients: (call.recipients ?? []).map((r) => mapRecipient(r, nameByPhone, input.code)),
    failure_code: call.failureCode ?? null,
    failure_message: call.failureMessage ?? null,
    created_at: call.createdAt,
    completed_at: call.completedAt ?? undefined,
    metadata: (call.metadata as Record<string, unknown>) ?? { rfq_id: input.rfqId },
  };
}

// ---- public adapter API (mode-agnostic to callers) ----

export async function createQuoteCall(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  if (!isLive()) {
    const task = loadFixture(input.code);
    task.metadata = { rfq_id: input.rfqId };
    return { callId: task.id, mode: "mock", task };
  }

  const c = client();
  const primaryClinic = input.clinics[0]?.name ?? "the clinic";
  // LIVE API CONSTRAINTS (verified against api.heycall-e.com, 2026-09-14):
  //   1. Structured extraction is NOT accepted on this tier. Sending `resultSchema` or
  //      `recipientResultSchema` returns 400 "<field> is not supported", even though the
  //      OpenAPI spec + @call-e/calle SDK types expose both. So we DO NOT send them here;
  //      instead we derive the per-recipient RecipientResult from CALL-E's returned text
  //      (summary + transcript_turns) via extract.ts, honoring no-fabricated-quotes.
  //   2. Locale/region support is limited. locale "en-US" / region "US" is the verified
  //      supported combination; e.g. English calls to Nigeria are rejected with
  //      422 "English calls to Nigeria are not supported".
  const call = await c.calls.createAndWait(
    {
      task: buildTaskPrompt(input.procedure, input.code, primaryClinic),
      recipients: input.clinics.map((cl) => ({ phones: [cl.phone], locale: "en-US", region: "US" })),
      metadata: { rfq_id: input.rfqId },
      webhookUrl: env.calleWebhookUrl(),
    },
    { idempotencyKey: input.rfqId }
  );
  const task = mapCallToTask(call, input);
  return { callId: task.id, mode: "live", task };
}

export async function getCall(callId: string, code: string, input?: CreateQuoteInput): Promise<CallTask> {
  if (!isLive()) {
    return loadFixture(code);
  }
  const c = client();
  const call = await c.calls.get(callId);
  return mapCallToTask(call, input ?? { procedure: "", code, clinics: [], rfqId: "" });
}

export async function listCallEvents(callId: string, code: string): Promise<CallEvent[]> {
  if (!isLive()) {
    // Mock event stream mirrors the fixture recipients moving to completed.
    return synthMockEvents(code);
  }
  const c = client();
  const list = await c.calls.listEvents(callId);
  return (list.data ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    created_at: e.created_at,
    data: { call_id: e.call_id, level: e.level },
  }));
}

export async function maybeRunGoal(clinic: Clinic, rfqId: string): Promise<Call["structuredResult"] | null> {
  const goalId = env.calleGoalId();
  if (!goalId || !isLive()) return null;
  const c = client();
  // Real Goals are single-phone per run; idempotencyKey ties a retry to one logical run.
  const run = await c.goals.runAndWait({
    goalId,
    phone: clinic.phone,
    variables: { clinic_name: clinic.name },
    idempotencyKey: `${rfqId}:${clinic.phone}`,
  });
  return run.result ?? null;
}

function synthMockEvents(code: string): CallEvent[] {
  const task = loadFixture(code);
  const base = Date.parse(task.created_at ?? "2026-09-14T08:00:00Z");
  const events: CallEvent[] = [{ id: "ev_queued", type: "call.queued", created_at: new Date(base).toISOString() }];
  task.recipients.forEach((r, i) => {
    events.push({
      id: `ev_prog_${i}`,
      type: "call.in_progress",
      created_at: new Date(base + (i + 1) * 4000).toISOString(),
      data: { recipient: r.name, status: "in_progress" },
    });
    events.push({
      id: `ev_done_${i}`,
      type: "call.recipient_completed",
      created_at: new Date(base + (i + 1) * 8000).toISOString(),
      data: { recipient: r.name, status: "completed", outcome: r.structured_result?.outcome ?? "unknown" },
    });
  });
  events.push({ id: "ev_completed", type: "call.completed", created_at: new Date(base + 60000).toISOString() });
  return events;
}
