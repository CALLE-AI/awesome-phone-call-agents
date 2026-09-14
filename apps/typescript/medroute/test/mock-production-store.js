export class ProductionStore {
  constructor() { this.runs = []; this.idempotency = new Map(); this.cooldowns = new Set(); }
  async init() {}
  async readHistory(actor) { return this.runs.filter(run => run.actor === actor).map(run => run.record); }
  async reserveIdempotency(key, fingerprint) {
    if (key === process.env.MEDROUTE_TEST_PENDING_KEY && !this.seededPending) {
      this.seededPending = true;
      this.idempotency.set(key, { fingerprint, status: "pending", record: null });
    }
    const existing = this.idempotency.get(key);
    if (existing) return { created: false, ...existing };
    this.idempotency.set(key, { fingerprint, status: "pending", record: null });
    return { created: true };
  }
  async releaseIdempotency(key) { if (this.idempotency.get(key)?.status === "pending") this.idempotency.delete(key); }
  async markIdempotencyUnknown(key) { const item = this.idempotency.get(key); if (item?.status === "pending") item.status = "unknown"; }
  async saveRun(record, actor) {
    this.runs.unshift({ actor, record });
    if (record.idempotencyKey) this.idempotency.set(record.idempotencyKey, { fingerprint: record.requestFingerprint, status: "complete", record });
  }
  async reserveCooldowns(keys) { if (keys.some(key => this.cooldowns.has(key))) return false; keys.forEach(key => this.cooldowns.add(key)); return true; }
  async audit() {}
}
