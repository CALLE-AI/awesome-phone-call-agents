/** Durable, private files for a single deployment with a persistent local disk. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ApplicationInput, CallRecord, Clarification, Session } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export class SessionConflict extends Error {}

export async function createSession(input: {
  application: ApplicationInput;
  clarifications: Clarification[];
  replay?: boolean;
  synthetic?: boolean;
  ownerId?: string;
}): Promise<Session> {
  const session: Session = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    replay: input.replay ?? false,
    callId: null,
    call: null,
  };
  await persist(session);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${id}.json`), "utf8")) as Session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function updateSession(id: string, patch: Partial<Pick<Session,
  "callId" | "call" | "authorization" | "createState"
>>): Promise<Session | null> {
  const session = await getSession(id);
  if (!session) return null;
  const next = { ...session, ...patch };
  await persist(next);
  return next;
}

export async function findSessionByCallId(callId: string): Promise<Session | null> {
  let files: string[];
  try { files = await fs.readdir(DATA_DIR); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !validId(file.slice(0, -5))) continue;
    const session = await getSession(file.slice(0, -5));
    if (session?.callId === callId) return session;
  }
  return null;
}

export async function recordCall(sessionId: string, call: CallRecord): Promise<void> {
  await updateSession(sessionId, { callId: call.callId, call });
}

/** Serialize consent, create and reconciliation across processes sharing this disk. */
export async function withSessionLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (!validId(id)) throw new SessionConflict("Invalid session.");
  const dir = path.join(DATA_DIR, "locks");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, id);
  let handle;
  try { handle = await fs.open(file, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SessionConflict("Session is busy or interrupted. Reconcile its existing call before proceeding.");
    }
    throw error;
  }
  try { return await action(); }
  finally { await handle.close(); await fs.unlink(file); }
}

function destinationFile(phone: string) {
  return path.join(DATA_DIR, "destinations", `${createHash("sha256").update(phone).digest("hex")}.json`);
}

/** Reserve before network I/O. An unknown outcome blocks new sessions to the same number. */
export async function reserveDestination(session: Session): Promise<void> {
  const phone = session.authorization!.phone;
  await fs.mkdir(path.dirname(destinationFile(phone)), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await fs.open(destinationFile(phone), "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SessionConflict("This destination has an unresolved call. Reconcile that call; do not redial.");
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ sessionId: session.id }));
    await handle.sync();
  } finally { await handle.close(); }
}

export async function releaseDestination(session: Session): Promise<void> {
  const file = destinationFile(session.authorization!.phone);
  try {
    const marker = JSON.parse(await fs.readFile(file, "utf8"));
    if (marker.sessionId === session.id) await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persist(session: Session): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const target = path.join(DATA_DIR, `${session.id}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(session, null, 2));
    await handle.sync();
  } finally { await handle.close(); }
  await fs.rename(temporary, target);
}
