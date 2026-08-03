import pg from "pg";

export class ProductionStore {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString }); }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS medroute_runs (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS medroute_idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL, record_id TEXT REFERENCES medroute_runs(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS medroute_recipient_cooldowns (recipient_key TEXT PRIMARY KEY, called_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS medroute_audit_events (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), actor TEXT NOT NULL, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb);
    `);
  }

  async readHistory() {
    const { rows } = await this.pool.query("SELECT payload FROM medroute_runs ORDER BY created_at DESC LIMIT 100");
    return rows.map(row => row.payload);
  }

  async reserveIdempotency(key, fingerprint) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query("INSERT INTO medroute_idempotency (key, fingerprint, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING RETURNING key", [key, fingerprint]);
      if (inserted.rowCount) { await client.query("COMMIT"); return { created: true }; }
      const { rows } = await client.query("SELECT i.fingerprint, i.status, r.payload FROM medroute_idempotency i LEFT JOIN medroute_runs r ON r.id = i.record_id WHERE i.key = $1", [key]);
      await client.query("COMMIT");
      return { created: false, fingerprint: rows[0].fingerprint, status: rows[0].status, record: rows[0].payload || null };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async releaseIdempotency(key) { await this.pool.query("DELETE FROM medroute_idempotency WHERE key = $1 AND status = 'pending'", [key]); }

  async saveRun(record) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO medroute_runs (id, created_at, payload) VALUES ($1, $2, $3)", [record.id, record.createdAt, record]);
      if (record.idempotencyKey) await client.query("UPDATE medroute_idempotency SET status = 'complete', record_id = $2 WHERE key = $1", [record.idempotencyKey, record.id]);
      for (const result of record.results || []) if (result.recipientKey) await client.query("INSERT INTO medroute_recipient_cooldowns (recipient_key, called_at) VALUES ($1, $2) ON CONFLICT (recipient_key) DO UPDATE SET called_at = EXCLUDED.called_at", [result.recipientKey, record.createdAt]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async recentlyCalled(recipientKeys, cutoff) {
    const { rows } = await this.pool.query("SELECT recipient_key FROM medroute_recipient_cooldowns WHERE recipient_key = ANY($1) AND called_at >= $2", [recipientKeys, new Date(cutoff)]);
    return new Set(rows.map(row => row.recipient_key));
  }

  async audit(actor, action, metadata = {}) { await this.pool.query("INSERT INTO medroute_audit_events (actor, action, metadata) VALUES ($1, $2, $3)", [actor, action, metadata]); }
}
