import fs from 'fs';
import path from 'path';
import { VerificationRecord } from './types';
import { SEEDED_VERIFICATIONS } from '../fixtures/seed-data';

const DB_PATH = path.resolve(process.cwd(), '.vaultcall-store.json');

class VaultCallStore {
  private verifications: Map<string, VerificationRecord> = new Map();
  private isKillSwitchEngaged: boolean = false;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.verifications)) {
          data.verifications.forEach((v: VerificationRecord) => this.verifications.set(v.id, v));
          this.isKillSwitchEngaged = Boolean(data.killSwitch);
          return;
        }
      }
    } catch {
      // fallback to memory
    }
    this.seed();
  }

  private persist(): void {
    try {
      const data = {
        killSwitch: this.isKillSwitchEngaged,
        verifications: Array.from(this.verifications.values()),
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // non-critical if file system write fails
    }
  }

  public seed(): void {
    this.verifications.clear();
    this.isKillSwitchEngaged = false;
    SEEDED_VERIFICATIONS.forEach((v) => {
      this.verifications.set(v.id, JSON.parse(JSON.stringify(v)));
    });
    this.persist();
  }

  public listVerifications(): VerificationRecord[] {
    return Array.from(this.verifications.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getVerification(id: string): VerificationRecord | undefined {
    return this.verifications.get(id);
  }

  public saveVerification(record: VerificationRecord): void {
    this.verifications.set(record.id, record);
    this.persist();
  }

  public getKillSwitch(): boolean {
    return this.isKillSwitchEngaged;
  }

  public setKillSwitch(engaged: boolean): void {
    this.isKillSwitchEngaged = engaged;
    if (engaged) {
      // Halt any in-progress verifications immediately
      for (const [id, v] of this.verifications.entries()) {
        if (v.status === 'IN_PROGRESS' || v.status === 'PENDING_VERIFICATION') {
          v.status = 'KILLED_BY_OPERATOR';
          v.auditNotes.push(`Emergency Kill Switch engaged at ${new Date().toISOString()}. Dialing halted.`);
          this.verifications.set(id, v);
        }
      }
    }
    this.persist();
  }
}

export const store = new VaultCallStore();
