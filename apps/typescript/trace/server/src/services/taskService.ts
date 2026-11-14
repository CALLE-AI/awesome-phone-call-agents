import fs from 'node:fs';
import path from 'node:path';
import {
  VerificationStats,
  VerificationTask,
  VerificationQuestion,
  DigitalClaim,
  PhoneTarget,
} from '../types/index.js';
import { validateAndFormatE164 } from '../utils/phone.js';
import { GENERIC_DEMO_SCENARIOS } from '../data/genericDemoScenarios.js';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'tasks.json');

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class TaskService {
  private tasks: Map<string, VerificationTask> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    ensureDataDir();
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const list: VerificationTask[] = JSON.parse(raw);
        this.tasks.clear();
        list.forEach((t) => this.tasks.set(t.id, t));
      } catch (err) {
        console.error('Error loading tasks from disk:', err);
      }
    }
  }

  private saveToDisk() {
    ensureDataDir();
    const list = Array.from(this.tasks.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
  }

  public getAllTasks(): VerificationTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getTaskById(id: string): VerificationTask | undefined {
    return this.tasks.get(id);
  }

  public createTask(payload: {
    target: PhoneTarget;
    item: string;
    verificationType?: string;
    subject: string;
    verificationGoal: string;
    context?: string;
    questions: VerificationQuestion[];
    digitalClaim?: DigitalClaim;
  }): { success: boolean; task?: VerificationTask; error?: string } {
    // 1. Strict Phone Validation
    const phoneCheck = validateAndFormatE164(payload.target?.phoneNumber);
    if (!phoneCheck.valid) {
      return {
        success: false,
        error: phoneCheck.error || 'A valid E.164 phone number is strictly required to start a verification task.',
      };
    }

    if (!payload.target?.organizationName || !payload.target.organizationName.trim()) {
      return { success: false, error: 'Supplier / Company name is required.' };
    }

    if (!payload.item || !payload.item.trim()) {
      return { success: false, error: 'Item / Material / Resource cannot be empty.' };
    }

    if (!payload.subject || !payload.subject.trim()) {
      return { success: false, error: 'Verification subject cannot be empty.' };
    }

    if (!payload.verificationGoal || !payload.verificationGoal.trim()) {
      return { success: false, error: 'Verification goal cannot be empty.' };
    }

    if (!payload.questions || payload.questions.length === 0) {
      return { success: false, error: 'At least one verification question is required.' };
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const isLive = Boolean(
      (process.env.CALLE_API_KEY || process.env.CALL_E_API_KEY) &&
        process.env.PHONE_PROVIDER_MODE !== 'mock'
    );

    const newTask: VerificationTask = {
      id: taskId,
      createdAt: now,
      updatedAt: now,
      target: {
        ...payload.target,
        phoneNumber: phoneCheck.formatted, // Guaranteed validated E.164
      },
      item: payload.item.trim(),
      verificationType: payload.verificationType || 'Inventory / Availability',
      subject: payload.subject.trim(),
      verificationGoal: payload.verificationGoal.trim(),
      context: payload.context?.trim(),
      questions: payload.questions.map((q, idx) => ({
        id: q.id || `q_${idx + 1}`,
        order: q.order ?? idx + 1,
        question: q.question.trim(),
        expectedType: q.expectedType || 'text',
        required: Boolean(q.required),
        options: q.options,
      })),
      digitalClaim: payload.digitalClaim?.claimText
        ? {
            claimedStatus: payload.digitalClaim.claimedStatus || 'UNKNOWN',
            claimText: payload.digitalClaim.claimText.trim(),
            expectedQuantity: payload.digitalClaim.expectedQuantity,
            expectedDeliveryDate: payload.digitalClaim.expectedDeliveryDate,
            expectedLeadTime: payload.digitalClaim.expectedLeadTime,
            expectedPrice: payload.digitalClaim.expectedPrice,
            sourceUrl: payload.digitalClaim.sourceUrl?.trim(),
            sourceTimestamp: payload.digitalClaim.sourceTimestamp || now,
          }
        : undefined,
      status: 'UNKNOWN / INCONCLUSIVE',
      reviewStatus: 'NONE',
      callState: 'IDLE',
      mode: isLive ? 'LIVE' : 'MOCK',
      structuredResult: null,
      reconciliation: null,
      evidenceChain: null,
    };

    this.tasks.set(taskId, newTask);
    this.saveToDisk();
    return { success: true, task: newTask };
  }

  public updateTask(task: VerificationTask): void {
    task.updatedAt = new Date().toISOString();
    this.tasks.set(task.id, task);
    this.saveToDisk();
  }

  public deleteTask(id: string): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) {
      this.saveToDisk();
    }
    return deleted;
  }

  public getStats(): VerificationStats {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      inProgress: all.filter(
        (t) =>
          t.callState === 'QUEUED' ||
          t.callState === 'CALLING' ||
          t.callState === 'IN_PROGRESS'
      ).length,
      verified: all.filter((t) => t.status === 'VERIFIED').length,
      contradicted: all.filter((t) => t.status === 'CONTRADICTED').length,
      unreachable: all.filter((t) => t.status === 'UNREACHABLE').length,
      unknown: all.filter((t) => t.status === 'UNKNOWN / INCONCLUSIVE').length,
      needsReview: all.filter((t) => t.reviewStatus === 'NEEDS_REVIEW').length,
    };
  }

  public loadDemoCampaign(): VerificationTask[] {
    GENERIC_DEMO_SCENARIOS.forEach((t) => {
      this.tasks.set(t.id, JSON.parse(JSON.stringify(t)));
    });
    this.saveToDisk();
    return this.getAllTasks();
  }

  public clearTasks(): void {
    this.tasks.clear();
    this.saveToDisk();
  }
}

export const taskService = new TaskService();
