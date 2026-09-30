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
    followups_paused INTEGER NOT NULL DEFAULT 0,
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
    action_taken TEXT,
    action_link TEXT,
    recovered_cents INTEGER NOT NULL DEFAULT 0,
    chain_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    retry_of TEXT,
    scheduled_for TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Safe migrations for existing databases
try {
  db.exec("ALTER TABLE call_logs ADD COLUMN action_taken TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE call_logs ADD COLUMN action_link TEXT;");
} catch {}
try {
  db.exec("ALTER TABLE call_logs ADD COLUMN recovered_cents INTEGER NOT NULL DEFAULT 0;");
} catch {}

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
  followups_paused: number;
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
  action_taken: string | null;
  action_link: string | null;
  recovered_cents: number;
  chain_id: string;
  attempt_number: number;
  retry_of: string | null;
  scheduled_for: string | null;
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
      `INSERT INTO subscribers (id, name, phone, region, locale, email, plan_name, amount_cents, stripe_customer_id, status, followups_paused)
       VALUES (@id, @name, @phone, @region, @locale, @email, @plan_name, @amount_cents, @stripe_customer_id, @status, @followups_paused)`
    ).run(sub);
  },
  updateStatus(id: string, status: string) {
    db.prepare("UPDATE subscribers SET status = ? WHERE id = ?").run(status, id);
  },
  setFollowupsPaused(id: string, paused: boolean) {
    db.prepare("UPDATE subscribers SET followups_paused = ? WHERE id = ?").run(paused ? 1 : 0, id);
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
    log: Omit<
      CallLog,
      | "raw_result"
      | "decision"
      | "evidence"
      | "completed_at"
      | "created_at"
      | "action_taken"
      | "action_link"
      | "recovered_cents"
    > & {
      raw_result?: string | null;
      action_taken?: string | null;
      action_link?: string | null;
      recovered_cents?: number;
    }
  ) {
    db.prepare(
      `INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status, chain_id, attempt_number, retry_of, scheduled_for, action_taken, action_link, recovered_cents)
       VALUES (@id, @subscriber_id, @calle_call_id, @trigger_reason, @status, @chain_id, @attempt_number, @retry_of, @scheduled_for, @action_taken, @action_link, @recovered_cents)`
    ).run({
      ...log,
      action_taken: log.action_taken ?? null,
      action_link: log.action_link ?? null,
      recovered_cents: log.recovered_cents ?? 0,
    });
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
  markInitiating(id: string) {
    db.prepare("UPDATE call_logs SET status = 'initiating' WHERE id = ?").run(id);
  },
  markUncertain(id: string, reason: string) {
    db.prepare(
      "UPDATE call_logs SET status = 'uncertain', action_taken = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(reason, id);
  },
  cancel(id: string) {
    db.prepare("UPDATE call_logs SET status = 'canceled', completed_at = datetime('now') WHERE id = ?").run(id);
  },
  completeByCalleCallId(
    calleCallId: string,
    fields: {
      status: string;
      decision: string | null;
      evidence: string | null;
      raw_result: string;
      action_taken?: string | null;
      action_link?: string | null;
      recovered_cents?: number;
    }
  ) {
    db.prepare(
      `UPDATE call_logs
       SET status = @status, decision = @decision, evidence = @evidence, raw_result = @raw_result,
           action_taken = @action_taken, action_link = @action_link, recovered_cents = @recovered_cents,
           completed_at = datetime('now')
       WHERE calle_call_id = @calleCallId`
    ).run({
      ...fields,
      action_taken: fields.action_taken ?? null,
      action_link: fields.action_link ?? null,
      recovered_cents: fields.recovered_cents ?? 0,
      calleCallId,
    });
  },
  dueScheduled(): CallLog[] {
    return db
      .prepare("SELECT * FROM call_logs WHERE status = 'scheduled' AND datetime(scheduled_for) <= datetime('now')")
      .all() as CallLog[];
  },
  promoteToPendingConfirmation(id: string) {
    db.prepare("UPDATE call_logs SET status = 'pending_confirmation' WHERE id = ?").run(id);
  },
  cancelScheduledForSubscriber(subscriberId: string) {
    db.prepare(
      "UPDATE call_logs SET status = 'canceled', completed_at = datetime('now') WHERE subscriber_id = ? AND status = 'scheduled'"
    ).run(subscriberId);
  },
  countInChain(chainId: string): number {
    const row = db.prepare("SELECT COUNT(*) as n FROM call_logs WHERE chain_id = ?").get(chainId) as { n: number };
    return row.n;
  },
};

export function promoteDueScheduledCalls() {
  for (const call of callLogsTable.dueScheduled()) {
    callLogsTable.promoteToPendingConfirmation(call.id);
  }
}

export const webhookEventsTable = {
  has(eventId: string): boolean {
    return !!db.prepare("SELECT 1 FROM webhook_events WHERE event_id = ?").get(eventId);
  },
  insert(eventId: string) {
    db.prepare("INSERT OR IGNORE INTO webhook_events (event_id) VALUES (?)").run(eventId);
  },
};

export interface DashboardMetrics {
  totalAtRiskCents: number;
  totalRecoveredCents: number;
  recoveryRatePercent: number;
  activeSubscribersCount: number;
  pastDueCount: number;
  activeCallsCount: number;
  scheduledFollowupsCount: number;
  totalInterventionsCount: number;
}

export function getDashboardMetrics(): DashboardMetrics {
  const atRiskRow = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM subscribers WHERE status = 'past_due'")
    .get() as { total: number };

  const recoveredRow = db
    .prepare("SELECT COALESCE(SUM(recovered_cents), 0) as total FROM call_logs WHERE status = 'completed'")
    .get() as { total: number };

  const decisionsRow = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN decision IN ('retry_now', 'update_card') THEN 1 ELSE 0 END) as successful
       FROM call_logs
       WHERE status = 'completed'`
    )
    .get() as { total: number; successful: number };

  const totalInterventions = decisionsRow.total || 0;
  const successfulInterventions = decisionsRow.successful || 0;
  const recoveryRatePercent = totalInterventions > 0 ? Math.round((successfulInterventions / totalInterventions) * 100) : 0;

  const activeSubscribers = (db.prepare("SELECT COUNT(*) as n FROM subscribers WHERE status = 'active'").get() as { n: number }).n;
  const pastDueSubscribers = (db.prepare("SELECT COUNT(*) as n FROM subscribers WHERE status = 'past_due'").get() as { n: number }).n;
  const activeCalls = (db.prepare("SELECT COUNT(*) as n FROM call_logs WHERE status IN ('in_progress', 'pending_confirmation')").get() as { n: number }).n;
  const scheduledFollowups = (db.prepare("SELECT COUNT(*) as n FROM call_logs WHERE status = 'scheduled'").get() as { n: number }).n;

  return {
    totalAtRiskCents: atRiskRow.total,
    totalRecoveredCents: recoveredRow.total,
    recoveryRatePercent,
    activeSubscribersCount: activeSubscribers,
    pastDueCount: pastDueSubscribers,
    activeCallsCount: activeCalls,
    scheduledFollowupsCount: scheduledFollowups,
    totalInterventionsCount: totalInterventions,
  };
}

export function resetData() {
  db.exec(`
    DELETE FROM call_logs;
    DELETE FROM subscribers;
    DELETE FROM webhook_events;
  `);
}

export function seedDemoData() {
  resetData();

  const now = Date.now();
  const tMinus2h = new Date(now - 2 * 3600 * 1000).toISOString();
  const tMinus1h55m = new Date(now - (1 * 3600 + 55 * 60) * 1000).toISOString();
  const tMinus45m = new Date(now - 45 * 60 * 1000).toISOString();
  const tMinus42m = new Date(now - 42 * 60 * 1000).toISOString();
  const tMinus18h = new Date(now - 18 * 3600 * 1000).toISOString();
  const tMinus17h58m = new Date(now - (17 * 3600 + 58 * 60) * 1000).toISOString();
  const futureTime = new Date(now + 6 * 3600 * 1000).toISOString();

  // Case 1: Demo Customer Alpha - Recovered via Retry Now
  // NOTE: Using the CALL-E team test number (+12763229632, US) for demo subscribers
  // as provided by the CALL-E platform documentation for building/testing.
  const sub1Id = "sub_demo_alpha";
  subscribersTable.insert({
    id: sub1Id,
    name: "Demo Customer Alpha",
    phone: "+12763229632",
    region: "US",
    locale: "en-US",
    email: "alpha@example.com",
    plan_name: "Pro Enterprise",
    amount_cents: 49000,
    stripe_customer_id: "cus_demo_alpha",
    status: "active",
    followups_paused: 0,
    created_at: new Date(now - 86400000).toISOString(),
  });

  const call1Id = "call_demo_alpha";
  const call1RawResult = {
    id: "calle_call_alpha_recovered",
    object: "call_task",
    status: "completed",
    summary: "Reached Demo Customer Alpha regarding Pro Enterprise renewal. Customer verified new card arrival and provided advisory authorization to retry the charge.",
    completion_confidence: { label: "high", score: 0.95 },
    evidence: [
      "Customer confirmed identity as Customer Alpha.",
      "Customer indicated the renewal card had just arrived.",
      "Customer provided affirmative verbal confirmation for payment retry."
    ],
    structured_result: {
      decision: "retry_now",
      evidence: "Customer stated: 'Yes, my replacement card arrived with updated expiry. Please retry the charge.'"
    },
    recipients: [
      {
        phone: "+12763229632",
        region: "US",
        locale: "en-US",
        status: "completed",
        transcript_turns: [
          { offset_seconds: 0, speaker: "bot", text: "Hi, is this Customer Alpha? I am calling regarding your Pro Enterprise subscription." },
          { offset_seconds: 4, speaker: "user", text: "Yes, speaking. Did something happen with our account renewal?" },
          { offset_seconds: 8, speaker: "bot", text: "The annual payment did not go through because the card on file expired. Would you like us to retry the charge, provide a link to update it, or pause for now?" },
          { offset_seconds: 19, speaker: "user", text: "Our replacement card arrived yesterday. You can retry the payment now." },
          { offset_seconds: 28, speaker: "bot", text: "Thank you. I have recorded your confirmation for retry. An operator will review and process this shortly. Goodbye!" },
          { offset_seconds: 36, speaker: "user", text: "Thank you, goodbye!" }
        ]
      }
    ]
  };

  db.prepare(`
    INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status, decision, evidence, raw_result, action_taken, action_link, recovered_cents, chain_id, attempt_number, retry_of, scheduled_for, created_at, completed_at)
    VALUES (?, ?, ?, ?, 'completed', 'retry_now', ?, ?, ?, NULL, 49000, ?, 1, NULL, NULL, ?, ?)
  `).run(
    call1Id,
    sub1Id,
    "calle_call_alpha_recovered",
    "Card expired.",
    "Customer authorized payment re-attempt after new card arrival.",
    JSON.stringify(call1RawResult),
    "Advisory retry approved by customer. Charge settled on Stripe (ch_mock_alpha_490)",
    call1Id,
    tMinus2h,
    tMinus1h55m
  );

  // Case 2: Demo Customer Beta - Self-Service Update Card Request
  const sub2Id = "sub_demo_beta";
  subscribersTable.insert({
    id: sub2Id,
    name: "Demo Customer Beta",
    phone: "+12763229632",
    region: "US",
    locale: "en-US",
    email: "beta@example.org",
    plan_name: "Growth Team",
    amount_cents: 12900,
    stripe_customer_id: "cus_demo_beta",
    status: "active",
    followups_paused: 0,
    created_at: new Date(now - 43200000).toISOString(),
  });

  const call2Id = "call_demo_beta";
  const call2RawResult = {
    id: "calle_call_beta_update_card",
    object: "call_task",
    status: "completed",
    summary: "Spoke with Demo Customer Beta about declined charge. Customer requested a self-service link to input their new card details.",
    completion_confidence: { label: "high", score: 0.92 },
    evidence: [
      "Customer answered directly.",
      "Customer requested self-service link for card update."
    ],
    structured_result: {
      decision: "update_card",
      evidence: "Customer requested: 'Please provide a self-service link and I will update our card details today.'"
    },
    recipients: [
      {
        phone: "+12763229632",
        region: "US",
        locale: "en-US",
        status: "completed",
        transcript_turns: [
          { offset_seconds: 0, speaker: "bot", text: "Hello Customer Beta, calling regarding your Growth Team subscription renewal." },
          { offset_seconds: 5, speaker: "user", text: "Hello. Yes, what is this regarding?" },
          { offset_seconds: 8, speaker: "bot", text: "Your recent renewal was declined. Would you like to retry, receive a secure link to update your card, or pause the plan?" },
          { offset_seconds: 21, speaker: "user", text: "We changed banking providers. Could you provide a self-service link to add the new card?" },
          { offset_seconds: 31, speaker: "bot", text: "A secure billing update link has been prepared. Thank you!" },
          { offset_seconds: 38, speaker: "user", text: "Thank you, appreciate it." }
        ]
      }
    ]
  };

  db.prepare(`
    INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status, decision, evidence, raw_result, action_taken, action_link, recovered_cents, chain_id, attempt_number, retry_of, scheduled_for, created_at, completed_at)
    VALUES (?, ?, ?, ?, 'completed', 'update_card', ?, ?, ?, ?, 0, ?, 1, NULL, NULL, ?, ?)
  `).run(
    call2Id,
    sub2Id,
    "calle_call_beta_update_card",
    "Card was declined.",
    "Customer requested self-service billing link.",
    JSON.stringify(call2RawResult),
    "Generated secure customer billing portal link for self-service card update",
    "https://billing.stripe.com/p/session/demo_recover_card_update_beta",
    call2Id,
    tMinus45m,
    tMinus42m
  );

  // Case 3: Demo Customer Gamma - No Answer, Follow-Up Scheduled (Attempt 2 of 3)
  const sub3Id = "sub_demo_gamma";
  subscribersTable.insert({
    id: sub3Id,
    name: "Demo Customer Gamma",
    phone: "+12763229632",
    region: "US",
    locale: "en-US",
    email: "gamma@example.net",
    plan_name: "Startup Scale",
    amount_cents: 8900,
    stripe_customer_id: "cus_demo_gamma",
    status: "past_due",
    followups_paused: 0,
    created_at: new Date(now - 172800000).toISOString(),
  });

  const chain3Id = "chain_demo_gamma";
  const call3aId = "call_demo_gamma_1";
  const call3aRawResult = {
    id: "calle_call_gamma_attempt_1",
    object: "call_task",
    status: "completed",
    summary: "The call reached an automated voicemail system. No live person was available to speak with.",
    completion_confidence: { label: "high", score: 0.89 },
    evidence: ["Call reached automated voicemail system."],
    structured_result: {
      decision: "no_answer",
      evidence: ""
    },
    recipients: [
      {
        phone: "+12763229632",
        region: "US",
        locale: "en-US",
        status: "completed",
        transcript_turns: [
          { offset_seconds: 0, speaker: "bot", text: "Hello, calling regarding your Startup Scale subscription renewal..." },
          { offset_seconds: 4, speaker: "user", text: "The person you are calling is unavailable. Please leave a message after the tone." },
          { offset_seconds: 11, speaker: "bot", text: "Automated recording detected. Ending call to schedule bounded follow-up." }
        ]
      }
    ]
  };

  db.prepare(`
    INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status, decision, evidence, raw_result, action_taken, action_link, recovered_cents, chain_id, attempt_number, retry_of, scheduled_for, created_at, completed_at)
    VALUES (?, ?, ?, ?, 'completed', 'no_answer', ?, ?, 'Customer unavailable on attempt 1. Bounded follow-up queued.', NULL, 0, ?, 1, NULL, NULL, ?, ?)
  `).run(
    call3aId,
    sub3Id,
    "calle_call_gamma_attempt_1",
    "Insufficient funds.",
    "Call reached voicemail system.",
    JSON.stringify(call3aRawResult),
    chain3Id,
    tMinus18h,
    tMinus17h58m
  );

  // Scheduled Attempt 2
  const call3bId = "call_demo_gamma_2";
  db.prepare(`
    INSERT INTO call_logs (id, subscriber_id, calle_call_id, trigger_reason, status, decision, evidence, raw_result, action_taken, action_link, recovered_cents, chain_id, attempt_number, retry_of, scheduled_for, created_at, completed_at)
    VALUES (?, ?, NULL, ?, 'scheduled', NULL, NULL, NULL, 'Follow-up attempt 2 of 3 queued', NULL, 0, ?, 2, ?, ?, ?, NULL)
  `).run(
    call3bId,
    sub3Id,
    "Insufficient funds.",
    chain3Id,
    call3aId,
    futureTime,
    tMinus17h58m
  );
}

export default db;