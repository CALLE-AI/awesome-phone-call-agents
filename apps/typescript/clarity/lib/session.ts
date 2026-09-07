/**
 * Session storage: an in-memory Map plus a JSON file per session under `data/`.
 *
 * Sessions are demo-scoped, so there is no database. The file mirror exists so
 * a session survives a dev-server hot reload — which matters because a call in
 * flight outlives a code edit.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApplicationInput, CallRecord, Clarification, Session } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

const memory = new Map<string, Session>();

export async function createSession(input: {
  application: ApplicationInput;
  clarifications: Clarification[];
  replay?: boolean;
  synthetic?: boolean;
}): Promise<Session> {
  const session: Session = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    replay: input.replay ?? false,
    synthetic: input.synthetic,
    application: input.application,
    clarifications: input.clarifications,
    callId: null,
    call: null,
  };
  memory.set(session.id, session);
  await persist(session);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  // Session IDs become filenames; reject paths and IDs the app cannot generate.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const cached = memory.get(id);
  if (cached) return cached;

  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${id}.json`), "utf8");
    const session = JSON.parse(raw) as Session;
    memory.set(id, session);
    return session;
  } catch {
    return null;
  }
}

export async function updateSession(
  id: string,
  patch: Partial<Pick<Session, "callId" | "call">>,
): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  const next = { ...session, ...patch };
  memory.set(id, next);
  await persist(next);
  return next;
}

/** Webhook deliveries arrive keyed by call id, not session id. */
export async function findSessionByCallId(callId: string): Promise<Session | null> {
  for (const session of memory.values()) {
    if (session.callId === callId) return session;
  }
  try {
    const files = await fs.readdir(DATA_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
      const session = JSON.parse(raw) as Session;
      if (session.callId === callId) {
        memory.set(session.id, session);
        return session;
      }
    }
  } catch {
    // no data dir yet
  }
  return null;
}

export async function recordCall(sessionId: string, call: CallRecord): Promise<void> {
  await updateSession(sessionId, { callId: call.callId, call });
}

async function persist(session: Session): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, `${session.id}.json`),
      JSON.stringify(session, null, 2),
      "utf8",
    );
  } catch {
    // The Map is the source of truth; a read-only filesystem must not break a call.
  }
}
