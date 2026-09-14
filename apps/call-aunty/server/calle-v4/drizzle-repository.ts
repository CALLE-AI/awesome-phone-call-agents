import { eq } from "drizzle-orm";
import { calleApiCalls, calleApiEvents, calleApiIdempotency } from "../../drizzle/schema";
import { getDb } from "../db";
import type { CalleCall, CalleEvent } from "./types";
import type { CallRepository } from "./repository";

function parseCall(raw: string): CalleCall {
  return JSON.parse(raw) as CalleCall;
}

/**
 * Drizzle-backed repository. Returns null when DATABASE_URL is unset so
 * the Express bootstrap can fall back to MemoryCallRepository.
 */
export function createDrizzleCallRepository(): CallRepository | null {
  if (!process.env.DATABASE_URL) return null;
  return new DrizzleCallRepository();
}

export class DrizzleCallRepository implements CallRepository {
  async putCall(call: CalleCall, userId?: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    const row = {
      id: call.id,
      providerCallId: call.id,
      userId: userId ?? "unknown",
      status: call.status,
      task: call.task,
      structuredResultJson: call.structured_result ? JSON.stringify(call.structured_result) : null,
      summary: call.summary,
      taskCompleted: call.task_completed == null ? null : call.task_completed ? 1 : 0,
      completionConfidence:
        call.completion_confidence == null ? null : Math.round(call.completion_confidence * 100),
      metadataJson: JSON.stringify(call.metadata ?? {}),
      payloadJson: JSON.stringify(call),
    };
    await db
      .insert(calleApiCalls)
      .values(row)
      .onDuplicateKeyUpdate({
        set: {
          status: row.status,
          structuredResultJson: row.structuredResultJson,
          summary: row.summary,
          taskCompleted: row.taskCompleted,
          completionConfidence: row.completionConfidence,
          metadataJson: row.metadataJson,
          payloadJson: row.payloadJson,
          updatedAt: new Date(),
        },
      });
  }

  async getCall(id: string): Promise<CalleCall | null> {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(calleApiCalls).where(eq(calleApiCalls.id, id)).limit(1);
    if (!rows[0]) return null;
    return parseCall(rows[0].payloadJson);
  }

  async listCalls(userId?: string): Promise<CalleCall[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = userId
      ? await db.select().from(calleApiCalls).where(eq(calleApiCalls.userId, userId))
      : await db.select().from(calleApiCalls);
    return rows.map((row) => parseCall(row.payloadJson));
  }

  async putEvent(event: CalleEvent): Promise<boolean> {
    const db = await getDb();
    if (!db) return true;
    const existing = await db
      .select({ id: calleApiEvents.id })
      .from(calleApiEvents)
      .where(eq(calleApiEvents.id, event.id))
      .limit(1);
    if (existing[0]) return false;
    await db.insert(calleApiEvents).values({
      id: event.id,
      providerCallId: event.data.id,
      type: event.type,
      payloadJson: JSON.stringify(event),
      createdAt: new Date(event.created_at),
    });
    return true;
  }

  async listEvents(callId: string): Promise<CalleEvent[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(calleApiEvents)
      .where(eq(calleApiEvents.providerCallId, callId));
    return rows
      .map((row) => JSON.parse(row.payloadJson) as CalleEvent)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async putIdempotency(key: string, callId: string, requestHash: string): Promise<boolean> {
    const db = await getDb();
    if (!db) return true;
    const existing = await db
      .select()
      .from(calleApiIdempotency)
      .where(eq(calleApiIdempotency.key, key))
      .limit(1);
    if (existing[0]) return false;
    await db.insert(calleApiIdempotency).values({
      key,
      providerCallId: callId,
      requestHash,
    });
    return true;
  }

  async getIdempotency(key: string): Promise<{ callId: string; requestHash: string } | null> {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(calleApiIdempotency)
      .where(eq(calleApiIdempotency.key, key))
      .limit(1);
    if (!rows[0]) return null;
    return { callId: rows[0].providerCallId, requestHash: rows[0].requestHash };
  }
}
