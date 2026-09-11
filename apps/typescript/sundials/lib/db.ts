import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  formatSdkKey,
  harborSeedPassword,
  hashPassword,
  HARBOR_USERNAME,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  slugFromCompany,
  type SundialAccount
} from "./accounts.ts";
import { createFixtureCallRecord } from "./calle/fixture.ts";
import { fetchLiveCalleCall } from "./calle/live-binding.ts";
import { handleCallSavedForRetry, processDueRetries } from "./calle/retry.ts";
import { applyCalleSnapshot, isInFlightStatus } from "./calle/sync-live.ts";
import { maskEmail, maskPhoneNumber } from "./calle/security.ts";
import { HARBOR_ACCOUNT_ID } from "./sdk/public-key.ts";
import { buildAnalytics, buildLeadQueue } from "./intent/analytics.ts";
import { behaviorFromEvents, declaredInterestFromEvents } from "./intent/profile.ts";
import { scoreEvents } from "./intent/score.ts";
import { newEntityId } from "./ids.ts";
import type {
  AnalyticsSnapshot,
  LeadQueueItem,
  SundialCallRecord,
  SundialEvent,
  SpeedToLeadMetrics,
  VisitorRecord,
  WebSessionContext
} from "./types.ts";

const DRY_RUN_DIALING_MS = 1500;
const DRY_RUN_IN_PROGRESS_MS = 3500;
const DRY_RUN_COMPLETE_MS = 8000;

function inAnalyticsRange(iso: string | undefined, range: "today" | "7d" | "30d"): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  const windowMs = range === "today" ? 86_400_000 : range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return Date.now() - t <= windowMs;
}

function forAccountId<T extends { accountId?: string }>(rows: T[], accountId?: string): T[] {
  if (!accountId) return rows;
  return rows.filter((row) => row.accountId === accountId);
}

function callsForAccount(calls: SundialCallRecord[], accountId?: string): SundialCallRecord[] {
  if (!accountId) return calls;
  return calls.filter((call) => (call.session?.accountId || HARBOR_ACCOUNT_ID) === accountId);
}

function analyticsFromStore(
  store: SundialsDatabase,
  range?: "today" | "7d" | "30d",
  accountId?: string
): AnalyticsSnapshot {
  const visitors = forAccountId(store.getAllVisitors(), accountId).filter((visitor) =>
    range ? inAnalyticsRange(visitor.lastSeenAt, range) : true
  );
  const events = forAccountId(store.getAllEvents(), accountId).filter((event) =>
    range ? inAnalyticsRange(event.timestamp, range) : true
  );
  const calls = callsForAccount(store.getAllCalls(), accountId).filter((call) =>
    range ? inAnalyticsRange(call.requestedAt, range) : true
  );
  return buildAnalytics(visitors, events, calls);
}

function leadQueueFromStore(store: SundialsDatabase, accountId?: string): LeadQueueItem[] {
  const visitors = forAccountId(store.getAllVisitors(), accountId);
  const eventsByVisitor = new Map<string, SundialEvent[]>();
  for (const event of forAccountId(store.getAllEvents(), accountId)) {
    const list = eventsByVisitor.get(event.visitorId) || [];
    list.push(event);
    eventsByVisitor.set(event.visitorId, list);
  }
  return buildLeadQueue(visitors, eventsByVisitor, callsForAccount(store.getAllCalls(), accountId));
}

export function defaultDbPath(): string {
  return process.env.SUNDIALS_DB_PATH || join(process.cwd(), "data", "sundials.db");
}

export class SundialsDatabase {
  private sqlite: DatabaseSync;
  private readonly persistent: boolean;

  constructor(path = defaultDbPath()) {
    this.persistent = path !== ":memory:";
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.sqlite = new DatabaseSync(path);
    if (path !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL;");
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        requested_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS visitors (
        visitor_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_account ON events (account_id, timestamp);
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        company_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        sdk_key TEXT UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
    this.seedHarborAccount();
  }

  private parseAccount(row: {
    id: string;
    username: string;
    company_name: string;
    password_hash: string;
    sdk_key: string | null;
    created_at: string;
  }): SundialAccount {
    return {
      id: row.id,
      username: row.username,
      companyName: row.company_name,
      passwordHash: row.password_hash,
      sdkKey: row.sdk_key,
      createdAt: row.created_at
    };
  }

  private seedHarborAccount(): void {
    if (this.getAccount(HARBOR_ACCOUNT_ID)) return;
    this.sqlite
      .prepare(
        `INSERT INTO accounts (id, username, company_name, password_hash, sdk_key, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      )
      .run(
        HARBOR_ACCOUNT_ID,
        HARBOR_USERNAME,
        "Harbor",
        hashPassword(harborSeedPassword()),
        new Date().toISOString()
      );
  }

  public getAccount(id: string): SundialAccount | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT id, username, company_name, password_hash, sdk_key, created_at FROM accounts WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          username: string;
          company_name: string;
          password_hash: string;
          sdk_key: string | null;
          created_at: string;
        }
      | undefined;
    return row ? this.parseAccount(row) : undefined;
  }

  public getAccountByUsername(username: string): SundialAccount | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT id, username, company_name, password_hash, sdk_key, created_at
         FROM accounts WHERE lower(username) = ?`
      )
      .get(normalizeUsername(username)) as
      | {
          id: string;
          username: string;
          company_name: string;
          password_hash: string;
          sdk_key: string | null;
          created_at: string;
        }
      | undefined;
    return row ? this.parseAccount(row) : undefined;
  }

  public getAccountBySdkKey(sdkKey: string): SundialAccount | undefined {
    const key = sdkKey.trim();
    if (!key) return undefined;
    const row = this.sqlite
      .prepare(
        `SELECT id, username, company_name, password_hash, sdk_key, created_at
         FROM accounts WHERE sdk_key = ?`
      )
      .get(key) as
      | {
          id: string;
          username: string;
          company_name: string;
          password_hash: string;
          sdk_key: string | null;
          created_at: string;
        }
      | undefined;
    return row ? this.parseAccount(row) : undefined;
  }

  private allocateAccountId(companyName: string): string {
    const base = slugFromCompany(companyName);
    if (base === HARBOR_ACCOUNT_ID) {
      /* Harbor id is reserved for the seed; signups get a suffix. */
    }
    let candidate = base === HARBOR_ACCOUNT_ID ? `${base}-2` : base;
    let n = 2;
    while (this.getAccount(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  public createAccount(input: {
    username: string;
    password: string;
    companyName: string;
  }): { ok: true; account: SundialAccount } | { ok: false; message: string } {
    const username = normalizeUsername(input.username);
    const companyName = input.companyName.trim();
    if (!username || username.length < 3) {
      return { ok: false, message: "Username must be at least 3 characters." };
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return { ok: false, message: "Username may only include letters, numbers, dots, underscores, and hyphens." };
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
    }
    if (!companyName) {
      return { ok: false, message: "Company name is required." };
    }
    if (this.getAccountByUsername(username)) {
      return { ok: false, message: "That username is already taken." };
    }
    const id = this.allocateAccountId(companyName);
    const account: SundialAccount = {
      id,
      username,
      companyName,
      passwordHash: hashPassword(input.password),
      sdkKey: null,
      createdAt: new Date().toISOString()
    };
    this.sqlite
      .prepare(
        `INSERT INTO accounts (id, username, company_name, password_hash, sdk_key, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      )
      .run(account.id, account.username, account.companyName, account.passwordHash, account.createdAt);
    return { ok: true, account };
  }

  public generateSdkKey(accountId: string): string {
    const account = this.getAccount(accountId);
    if (!account) throw new Error("Account not found.");
    let key = formatSdkKey(account.companyName);
    let attempts = 0;
    while (this.getAccountBySdkKey(key)) {
      attempts += 1;
      if (attempts > 5) throw new Error("Could not allocate an SDK key.");
      key = formatSdkKey(account.companyName);
    }
    this.sqlite.prepare("UPDATE accounts SET sdk_key = ? WHERE id = ?").run(key, accountId);
    return key;
  }

  private parseCall(payload: string): SundialCallRecord {
    return JSON.parse(payload) as SundialCallRecord;
  }

  private loadCall(id: string): SundialCallRecord | undefined {
    const row = this.sqlite.prepare("SELECT payload FROM calls WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;
    return row ? this.parseCall(row.payload) : undefined;
  }

  private loadAllCalls(): SundialCallRecord[] {
    const rows = this.sqlite.prepare("SELECT payload FROM calls").all() as { payload: string }[];
    return rows.map((row) => this.parseCall(row.payload));
  }

  public peekCalls(): SundialCallRecord[] {
    return this.loadAllCalls();
  }

  private advanceDryRunIfNeeded(call: SundialCallRecord): SundialCallRecord {
    if (!call.dryRun) return call;
    if (call.status === "completed" || call.status === "failed" || call.status === "no_answer") {
      return call;
    }
    if (!call.rawPhoneNumber) return call;
    if (call.retryDueAt && Date.now() < Date.parse(call.retryDueAt)) return call;

    const clockStart = call.retryDueAt ? Date.parse(call.retryDueAt) : Date.parse(call.requestedAt);
    const elapsed = Date.now() - (Number.isFinite(clockStart) ? clockStart : Date.parse(call.requestedAt));
    if (elapsed >= DRY_RUN_COMPLETE_MS) {
      const completed = createFixtureCallRecord(
        call.rawPhoneNumber,
        call.session,
        call.contactName,
        call.rawContactEmail || call.contactEmail,
        {
          company: call.company,
          companySize: call.companySize,
          useCase: call.useCase,
          visitorId: call.visitorId,
          declaredCta: call.declaredCta,
          declaredInterest: call.declaredInterest,
          intent: call.intentSnapshot,
          behavior: call.behaviorSnapshot
        }
      );
      completed.id = call.id;
      completed.requestedAt = call.requestedAt;
      completed.dryRun = true;
      completed.retryOfCallId = call.retryOfCallId;
      completed.retryCount = call.retryCount;
      completed.retryScheduledAt = call.retryScheduledAt;
      completed.retryDueAt = call.retryDueAt;
      completed.retryFiredAt = call.retryFiredAt;
      completed.speedToDialSec = parseFloat(Math.min(Math.max(elapsed / 1000, 8), 55).toFixed(1));
      if (completed.leadDossier) completed.leadDossier.callId = call.id;
      this.saveCall(completed);
      return completed;
    }

    if (elapsed >= DRY_RUN_IN_PROGRESS_MS && call.status !== "in_progress") {
      call.status = "in_progress";
      call.connectedAt = new Date().toISOString();
      this.saveCall(call);
    } else if (elapsed >= DRY_RUN_DIALING_MS && call.status === "queued") {
      call.status = "dialing";
      call.dialedAt = new Date().toISOString();
      this.saveCall(call);
    }

    return call;
  }

  public saveSession(session: WebSessionContext): void {
    this.sqlite
      .prepare(
        `INSERT INTO sessions (id, payload) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`
      )
      .run(session.id, JSON.stringify(session));
  }

  public getSession(id: string): WebSessionContext | undefined {
    const row = this.sqlite.prepare("SELECT payload FROM sessions WHERE id = ?").get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as WebSessionContext) : undefined;
  }

  public saveCall(call: SundialCallRecord, options?: { skipRetryHooks?: boolean }): void {
    this.sqlite
      .prepare(
        `INSERT INTO calls (id, requested_at, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET requested_at = excluded.requested_at, payload = excluded.payload`
      )
      .run(call.id, call.requestedAt, JSON.stringify(call));
    if (!options?.skipRetryHooks) handleCallSavedForRetry(this, call);
    if (this.persistent && process.env.GEMINI_API_KEY?.trim()) {
      void import("./brain/pipeline.ts").then((mod) => {
        if (mod.needsGeminiProfile(call)) mod.scheduleBrainAfterCall(this, call.id);
      });
    }
  }

  public getCall(id: string): SundialCallRecord | undefined {
    const call = this.loadCall(id);
    return call ? this.advanceDryRunIfNeeded(call) : undefined;
  }

  public getAllCalls(): SundialCallRecord[] {
    return this.loadAllCalls()
      .map((call) => this.advanceDryRunIfNeeded(call))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }

  public async refreshLiveCalls(taskId?: string): Promise<void> {
    const candidates = taskId
      ? ([this.loadCall(taskId)].filter(Boolean) as SundialCallRecord[])
      : this.loadAllCalls();
    for (const call of candidates) {
      if (call.dryRun || !call.calleCallId || !isInFlightStatus(call.status)) continue;
      const remote = await fetchLiveCalleCall(call.calleCallId);
      if (!remote) continue;
      this.saveCall(applyCalleSnapshot(call, remote));
    }
    processDueRetries(this);
  }

  public touchVisitor(partial: {
    visitorId: string;
    accountId: string;
    email?: string;
    phone?: string;
    company?: string;
    name?: string;
    companySize?: string;
    useCase?: string;
  }): VisitorRecord {
    const now = new Date().toISOString();
    const existing = this.getVisitor(partial.visitorId);
    const identified =
      Boolean(partial.email || partial.phone || partial.company) || Boolean(existing?.identifiedAt);
    const record: VisitorRecord = {
      visitorId: partial.visitorId,
      accountId: partial.accountId || existing?.accountId || "harbor",
      email: partial.email ? maskEmail(partial.email) : existing?.email,
      rawEmail: partial.email?.trim() || existing?.rawEmail,
      phone: partial.phone ? maskPhoneNumber(partial.phone) : existing?.phone,
      rawPhone: partial.phone || existing?.rawPhone,
      company: partial.company ?? existing?.company,
      name: partial.name ?? existing?.name,
      companySize: partial.companySize ?? existing?.companySize,
      useCase: partial.useCase ?? existing?.useCase,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      identifiedAt: identified ? existing?.identifiedAt || now : existing?.identifiedAt
    };
    this.sqlite
      .prepare(
        `INSERT INTO visitors (visitor_id, account_id, first_seen_at, last_seen_at, payload)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(visitor_id) DO UPDATE SET
           account_id = excluded.account_id,
           last_seen_at = excluded.last_seen_at,
           payload = excluded.payload`
      )
      .run(record.visitorId, record.accountId, record.firstSeenAt, record.lastSeenAt, JSON.stringify(record));
    return record;
  }

  public getVisitor(visitorId: string): VisitorRecord | undefined {
    const row = this.sqlite.prepare("SELECT payload FROM visitors WHERE visitor_id = ?").get(visitorId) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as VisitorRecord) : undefined;
  }

  public getAllVisitors(): VisitorRecord[] {
    const rows = this.sqlite.prepare("SELECT payload FROM visitors").all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as VisitorRecord);
  }

  public insertEvents(events: SundialEvent[]): number {
    const stmt = this.sqlite.prepare(
      `INSERT OR IGNORE INTO events (id, account_id, visitor_id, session_id, event, timestamp, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let accepted = 0;
    for (const event of events) {
      const info = stmt.run(
        event.id,
        event.accountId,
        event.visitorId,
        event.sessionId,
        event.event,
        event.timestamp,
        JSON.stringify(event)
      );
      accepted += Number(info.changes || 0);
    }
    return accepted;
  }

  public ingestEventBatch(input: {
    accountId: string;
    visitorId: string;
    sessionId: string;
    events: Array<{ event: string; properties?: Record<string, unknown>; timestamp?: string }>;
  }): number {
    this.touchVisitor({ visitorId: input.visitorId, accountId: input.accountId });
    const rows: SundialEvent[] = input.events.map((item) => ({
      id: newEntityId(),
      accountId: input.accountId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      event: item.event,
      properties: item.properties || {},
      timestamp: item.timestamp || new Date().toISOString()
    }));

    for (const row of rows) {
      if (row.event === "identify") {
        const p = row.properties;
        this.touchVisitor({
          visitorId: input.visitorId,
          accountId: input.accountId,
          email: typeof p.email === "string" ? p.email : undefined,
          phone: typeof p.phone === "string" ? p.phone : undefined,
          company: typeof p.company === "string" ? p.company : undefined,
          name: typeof p.name === "string" ? p.name : undefined,
          companySize: typeof p.companySize === "string" ? p.companySize : undefined,
          useCase: typeof p.useCase === "string" ? p.useCase : undefined
        });
        if (typeof p.phone === "string" && p.phone.trim()) {
          row.properties = { ...p, phone: maskPhoneNumber(p.phone) };
        }
        if (typeof p.email === "string" && p.email.trim()) {
          row.properties = { ...row.properties, email: maskEmail(String(p.email)) };
        }
      }
    }

    return this.insertEvents(rows);
  }

  public getEventsForVisitor(visitorId: string): SundialEvent[] {
    const rows = this.sqlite
      .prepare("SELECT payload FROM events WHERE visitor_id = ? ORDER BY timestamp ASC")
      .all(visitorId) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as SundialEvent);
  }

  public getAllEvents(): SundialEvent[] {
    const rows = this.sqlite.prepare("SELECT payload FROM events ORDER BY timestamp ASC").all() as {
      payload: string;
    }[];
    return rows.map((row) => JSON.parse(row.payload) as SundialEvent);
  }

  public snapshotForVisitor(visitorId: string, sessionId?: string) {
    const events = this.getEventsForVisitor(visitorId);
    return {
      intent: scoreEvents(events),
      behavior: behaviorFromEvents(events, sessionId),
      declaredInterest: declaredInterestFromEvents(events)
    };
  }

  public getMetrics(accountId?: string): SpeedToLeadMetrics {
    const all = callsForAccount(this.getAllCalls(), accountId);
    const completed = all.filter((c) => c.status === "completed" && c.speedToDialSec);
    const inFlight = all.filter((c) => isInFlightStatus(c.status));
    const avgSpeed =
      completed.length > 0
        ? completed.reduce((acc, curr) => acc + (curr.speedToDialSec || 0), 0) / completed.length
        : 0;

    const hotCount = all.filter(
      (c) => c.leadDossier?.intentTier === "hot" || c.opportunityProfile?.priority === "very_high"
    ).length;
    const conversionRate = all.length > 0 ? (hotCount / all.length) * 100 : 0;

    return {
      avgSpeedToDialSec: parseFloat(avgSpeed.toFixed(1)),
      totalCallsToday: all.length,
      hotLeadsCount: hotCount,
      conversionRatePercent: parseFloat(conversionRate.toFixed(1)),
      inFlightCallsCount: inFlight.length
    };
  }

  public getAnalytics(range?: "today" | "7d" | "30d", accountId?: string): AnalyticsSnapshot {
    return analyticsFromStore(this, range, accountId);
  }

  public getLeadQueue(accountId?: string): LeadQueueItem[] {
    return leadQueueFromStore(this, accountId);
  }

  public getLeadById(leadId: string, accountId?: string): LeadQueueItem | undefined {
    return this.getLeadQueue(accountId).find((lead) => lead.visitorId === leadId);
  }

  public getCallsForVisitor(visitorId: string): SundialCallRecord[] {
    return this.getAllCalls()
      .filter((call) => call.visitorId === visitorId)
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  }
}

const globalForDb = globalThis as unknown as { sundialsDb?: SundialsDatabase };

export function getSundialsDb(): SundialsDatabase {
  if (!globalForDb.sundialsDb) {
    globalForDb.sundialsDb = new SundialsDatabase();
  }
  return globalForDb.sundialsDb;
}

export const db = {
  saveSession: (session: WebSessionContext) => getSundialsDb().saveSession(session),
  getSession: (id: string) => getSundialsDb().getSession(id),
  saveCall: (call: SundialCallRecord, options?: { skipRetryHooks?: boolean }) =>
    getSundialsDb().saveCall(call, options),
  getCall: (id: string) => getSundialsDb().getCall(id),
  peekCalls: () => getSundialsDb().peekCalls(),
  getAllCalls: () => getSundialsDb().getAllCalls(),
  refreshLiveCalls: (taskId?: string) => getSundialsDb().refreshLiveCalls(taskId),
  getMetrics: (accountId?: string) => getSundialsDb().getMetrics(accountId),
  ingestEventBatch: (input: Parameters<SundialsDatabase["ingestEventBatch"]>[0]) =>
    getSundialsDb().ingestEventBatch(input),
  touchVisitor: (partial: Parameters<SundialsDatabase["touchVisitor"]>[0]) =>
    getSundialsDb().touchVisitor(partial),
  snapshotForVisitor: (visitorId: string, sessionId?: string) =>
    getSundialsDb().snapshotForVisitor(visitorId, sessionId),
  getAnalytics: (range?: Parameters<SundialsDatabase["getAnalytics"]>[0], accountId?: string) =>
    analyticsFromStore(getSundialsDb(), range, accountId),
  getLeadQueue: (accountId?: string) => leadQueueFromStore(getSundialsDb(), accountId),
  getLeadById: (leadId: string, accountId?: string) =>
    leadQueueFromStore(getSundialsDb(), accountId).find((lead) => lead.visitorId === leadId),
  getCallsForVisitor: (visitorId: string) =>
    getSundialsDb()
      .getAllCalls()
      .filter((call) => call.visitorId === visitorId)
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
};

export function toPublicCall(call: SundialCallRecord): SundialCallRecord {
  const { rawPhoneNumber, rawContactEmail, callConsentE164, ...pub } = call;
  void rawPhoneNumber;
  void rawContactEmail;
  void callConsentE164;
  return pub;
}

export function toPublicVisitor(visitor: VisitorRecord): VisitorRecord {
  const { rawEmail, rawPhone, ...pub } = visitor;
  void rawEmail;
  void rawPhone;
  return pub;
}
