import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "recover.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'US',
    locale TEXT NOT NULL DEFAULT 'en-US',
    email TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    stripe_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    subscriber_id TEXT NOT NULL,
    calle_call_id TEXT,
    trigger_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    decision TEXT,
    evidence TEXT,
    raw_result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface Subscriber {
  id: string;
  name: string;
  phone: string;
  region: string;
  locale: string;
  email: string;
  plan_name: string;
  amount_cents: number;
  stripe_customer_id: string | null;
  status: string;
  created_at: string;
}

export interface CallLog {
  id: string;
  subscriber_id: string;
  calle_call_id: string | null;
  trigger_reason: string;
  status: string;
  decision: string | null;
  evidence: string | null;
  raw_result: string | null;
  created_at: string;
  completed_at: string | null;
}

export const subscribersTable = {
  all(): Subscriber[] {
    return db.prepare("SELECT * FROM subscribers ORDER BY created_at DESC").all() as Subscriber[];
  },
  get(id: string): Subscriber | undefined {
    return db.prepare("SELECT * FROM subscribers WHERE id = ?").get(id) as Subscriber | undefined;
  },
  insert(sub: Subscriber) {
    db.prepare(
      `INSERT INTO subscribers (id, name, phone, region, locale, email, plan_name, amount_cents, stripe_customer_id, status)
       VALUES (@id, @name, @phone, @region, @locale, @email, @plan_name, @amount_cents, @stripe_customer_id, @status)`
    ).run(sub);
  },
  updateStatus(id: string, status: string) {
    db.prepare("UPDATE subscribers SET status = ? WHERE id = ?").run(status, id);
  },
};

export interface CallLogWithSubscriber extends CallLog {
  subscriber_name: string;
  subscriber_phone: string;
  subscriber_region: string;
  subscriber_locale: string;
  plan_name: string;
  amount_cents: number;
}

export const callLogsTable = {
  all(): CallLog[] {
    return db.prepare("SELECT * FROM call_logs ORDER BY created_at DESC").all() as CallLog[];
  },
  allWithSubscriber(): CallLogWithSubscriber[] {
    return db
      .prepare(
        `SELECT call_logs.*, subscribers.name AS subscriber_name, subscribers.phone AS subscriber_phone,
                subscribers.region AS subscriber_region, subscribers.locale AS subscriber_locale,
                subscribers.plan_name AS plan_name, subscribers.amount_cents AS amount_cents
         FROM call_logs
         JOIN subscribers ON subscribers.id = call_logs.subscriber_id
         ORDER BY call_logs.created_at DESC`
      )
      .all() as CallLogWithSubscriber[];
  },
  insert(
    log: Omit<CallLog, "raw_result" | "decision" | "evidence" | "completed_at" | "created_at"> & {
      raw_result?: string | null;
    }
  ) {
    db.prepare(
      `INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status)
       VALUES (@id, @subscriber_id, @calle_call_id, @trigger_reason, @status)`
    ).run(log);
  },
  get(id: string): CallLog | undefined {
    return db.prepare("SELECT * FROM call_logs WHERE id = ?").get(id) as CallLog | undefined;
  },
  findByCalleCallId(calleCallId: string): CallLog | undefined {
    return db.prepare("SELECT * FROM call_logs WHERE calle_call_id = ?").get(calleCallId) as CallLog | undefined;
  },
  attachCalleCall(id: string, calleCallId: string) {
    db.prepare("UPDATE call_logs SET calle_call_id = ?, status = 'in_progress' WHERE id = ?").run(calleCallId, id);
  },
  cancel(id: string) {
    db.prepare("UPDATE call_logs SET status = 'canceled', completed_at = datetime('now') WHERE id = ?").run(id);
  },
  completeByCalleCallId(
    calleCallId: string,
    fields: { status: string; decision: string | null; evidence: string | null; raw_result: string }
  ) {
    db.prepare(
      `UPDATE call_logs
       SET status = @status, decision = @decision, evidence = @evidence, raw_result = @raw_result, completed_at = datetime('now')
       WHERE calle_call_id = @calleCallId`
    ).run({ ...fields, calleCallId });
  },
};

export const webhookEventsTable = {
  has(eventId: string): boolean {
    return !!db.prepare("SELECT 1 FROM webhook_events WHERE event_id = ?").get(eventId);
  },
  insert(eventId: string) {
    db.prepare("INSERT OR IGNORE INTO webhook_events (event_id) VALUES (?)").run(eventId);
  },
};

export default db;