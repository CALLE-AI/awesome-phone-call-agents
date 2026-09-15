import fs from 'node:fs';
import path from 'node:path';
import { CallEProvider } from '../providers/CallEProvider.js';
import { MockProvider } from '../providers/MockProvider.js';
import { PhoneAgentProvider } from '../providers/PhoneAgentProvider.js';
import { taskService } from './taskService.js';
import { reconcileVerificationResult } from './reconciliation.js';
import { getOrCreateIdempotencyKey, recordCallDispatched, recordCallFailed, recordCallAmbiguous } from '../utils/idempotency.js';
import { isDestinationAuthorized, maskPhoneNumber } from '../utils/phone.js';
import { CallRecord, VerificationTask } from '../types/index.js';

const WEBHOOKS_FILE = path.resolve(process.cwd(), 'data', 'processed_webhooks.json');

function ensureDataDir() {
  const dir = path.dirname(WEBHOOKS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadProcessedWebhooks(): Set<string> {
  ensureDataDir();
  if (!fs.existsSync(WEBHOOKS_FILE)) {
    return new Set();
  }
  try {
    const raw = fs.readFileSync(WEBHOOKS_FILE, 'utf-8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveProcessedWebhook(eventId: string) {
  const set = loadProcessedWebhooks();
  set.add(eventId);
  ensureDataDir();
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(Array.from(set)), 'utf-8');
}

class CallService {
  private callEProvider: CallEProvider;
  private mockProvider: MockProvider;

  constructor() {
    this.callEProvider = new CallEProvider();
    this.mockProvider = new MockProvider();
  }

  private modeOverride: 'LIVE' | 'MOCK' | null = null;

  public setMode(mode: 'LIVE' | 'MOCK') {
    const isForcedMock = process.env.PHONE_PROVIDER_MODE === 'mock';
    if (isForcedMock && mode === 'LIVE') {
      throw new Error('Cannot switch to LIVE mode: Environment has forced PHONE_PROVIDER_MODE=mock.');
    }
    this.modeOverride = mode;
  }

  public getActiveProvider(forceMock = false): { provider: PhoneAgentProvider; mode: 'LIVE' | 'MOCK' } {
    // 1. If environment strictly forces mock mode, runtime override MUST NOT be able to bypass it
    const isForcedMock = process.env.PHONE_PROVIDER_MODE === 'mock';
    if (isForcedMock || forceMock) {
      return { provider: this.mockProvider, mode: 'MOCK' };
    }

    // 2. Explicit runtime override
    if (this.modeOverride) {
      if (this.modeOverride === 'LIVE' && this.callEProvider.isConfigured()) {
        return { provider: this.callEProvider, mode: 'LIVE' };
      }
      return { provider: this.mockProvider, mode: 'MOCK' };
    }

    // 3. Environment configuration: must be explicitly 'calle' to use LIVE mode
    const isExplicitCalleEnv = process.env.PHONE_PROVIDER_MODE === 'calle';
    if (isExplicitCalleEnv && this.callEProvider.isConfigured()) {
      return { provider: this.callEProvider, mode: 'LIVE' };
    }

    // 4. Default to NO-CALL / MOCK behavior
    return { provider: this.mockProvider, mode: 'MOCK' };
  }

  public isLiveAvailable(): boolean {
    const isForcedMock = process.env.PHONE_PROVIDER_MODE === 'mock';
    if (isForcedMock) return false;
    return this.callEProvider.isConfigured();
  }

  public async startVerification(
    taskId: string,
    forceMock = false,
    explicitLive = false
  ): Promise<{ success: boolean; task?: VerificationTask; error?: string; isAmbiguous?: boolean }> {
    const task = taskService.getTaskById(taskId);
    if (!task) {
      return { success: false, error: `Verification task ${taskId} not found.` };
    }

    if (!task.target.phoneNumber) {
      return { success: false, error: 'Cannot initiate verification call: target phone number is missing.' };
    }

    const { provider, mode } = this.getActiveProvider(forceMock);
    const idempotencyKey = getOrCreateIdempotencyKey(taskId);

    // Validate authorized destination for the active mode
    const authCheck = isDestinationAuthorized(task.target.phoneNumber, mode);
    if (!authCheck.authorized) {
      recordCallFailed(idempotencyKey, authCheck.reason);
      task.mode = mode;
      task.callState = 'FAILED';
      task.status = 'UNREACHABLE';
      task.reviewStatus = 'NONE';
      task.callRecord = {
        id: `call_${task.id}`,
        taskId: task.id,
        idempotencyKey,
        phoneNumber: authCheck.formatted,
        mode,
        callState: 'FAILED',
        startedAt: new Date().toISOString(),
        durationSeconds: 0,
        transcriptTurns: [],
        structuredResult: null,
        error: authCheck.reason,
      };
      task.reconciliation = reconcileVerificationResult(
        task.digitalClaim,
        null,
        'FAILED',
        task.callRecord,
        task.item
      );
      task.status = task.reconciliation.outcome;
      task.reviewStatus = task.reconciliation.reviewStatus;
      task.evidenceChain = task.reconciliation.evidenceChain;
      taskService.updateTask(task);
      return { success: false, error: authCheck.reason, task };
    }

    try {
      task.mode = mode;
      task.callState = 'QUEUED';
      task.status = 'UNKNOWN / INCONCLUSIVE';

      const { callId, initialRecord } = await provider.startVerificationCall(task, idempotencyKey);
      recordCallDispatched(idempotencyKey, callId);

      task.callRecord = initialRecord;
      taskService.updateTask(task);

      return { success: true, task };
    } catch (err: any) {
      const isDefinitiveRejection = Boolean(err.isDefinitiveRejection);
      const isAmbiguous = !isDefinitiveRejection || Boolean(err.isAmbiguous);

      if (isAmbiguous) {
        // Ambiguous submission (timeout / connection reset / 5xx): NEVER assume call was never accepted
        recordCallAmbiguous(idempotencyKey, err.message);
        task.callState = 'PENDING_RECONCILIATION';
        task.status = 'UNKNOWN / INCONCLUSIVE';
        task.reviewStatus = 'NEEDS_REVIEW';
        task.callRecord = {
          id: `call_${task.id}`,
          taskId: task.id,
          idempotencyKey,
          phoneNumber: authCheck.formatted,
          mode,
          callState: 'PENDING_RECONCILIATION',
          startedAt: new Date().toISOString(),
          durationSeconds: 0,
          transcriptTurns: [],
          structuredResult: null,
          error: `Ambiguous call submission (${err.message}). Preserving task record & stable idempotency key for reconciliation before retry.`,
        };
        task.reconciliation = reconcileVerificationResult(
          task.digitalClaim,
          null,
          'PENDING_RECONCILIATION',
          task.callRecord,
          task.item
        );
        task.status = task.reconciliation.outcome;
        task.reviewStatus = task.reconciliation.reviewStatus;
        task.evidenceChain = task.reconciliation.evidenceChain;
        taskService.updateTask(task);
        return { success: false, error: err.message, isAmbiguous: true, task };
      }

      // Definitive rejection (e.g. 401 auth failed, 422 invalid schema before dispatch)
      recordCallFailed(idempotencyKey, err.message);
      task.callState = 'FAILED';
      task.status = 'UNREACHABLE';
      task.callRecord = {
        id: `call_${task.id}`,
        taskId: task.id,
        idempotencyKey,
        phoneNumber: authCheck.formatted,
        mode,
        callState: 'FAILED',
        startedAt: new Date().toISOString(),
        durationSeconds: 0,
        transcriptTurns: [],
        structuredResult: null,
        error: err.message || 'Call initiation failed',
      };
      task.reconciliation = reconcileVerificationResult(
        task.digitalClaim,
        null,
        'FAILED',
        task.callRecord,
        task.item
      );
      task.status = task.reconciliation.outcome;
      task.reviewStatus = task.reconciliation.reviewStatus;
      task.evidenceChain = task.reconciliation.evidenceChain;
      taskService.updateTask(task);
      return { success: false, error: err.message, task };
    }
  }

  public async pollCallProgress(
    callId: string,
    taskId?: string
  ): Promise<{ success: boolean; task?: VerificationTask; record?: CallRecord; error?: string }> {
    let task: VerificationTask | undefined;
    if (taskId) {
      task = taskService.getTaskById(taskId);
    } else {
      task = taskService.getAllTasks().find((t) => t.callRecord?.providerCallId === callId || t.callRecord?.id === callId);
    }

    if (!task) {
      return { success: false, error: `No task found corresponding to call ID ${callId}.` };
    }

    const provider = task.mode === 'LIVE' ? this.callEProvider : this.mockProvider;

    try {
      const record = await provider.getCallProgress(callId, task);

      task.callRecord = record;
      task.callState = record.callState;

      if (record.structuredResult) {
        task.structuredResult = record.structuredResult;
      }

      // If call is finished or failed, deterministically reconcile
      if (
        record.callState === 'COMPLETED' ||
        record.callState === 'FAILED' ||
        record.callState === 'CANCELED'
      ) {
        const reconciliation = reconcileVerificationResult(
          task.digitalClaim,
          record.structuredResult,
          record.callState,
          record,
          task.item
        );
        task.reconciliation = reconciliation;
        task.status = reconciliation.outcome;
        task.reviewStatus = reconciliation.reviewStatus;
        task.evidenceChain = reconciliation.evidenceChain;
      }

      taskService.updateTask(task);
      return { success: true, task, record };
    } catch (err: any) {
      return { success: false, error: err.message, task };
    }
  }

  public async handleWebhookEvent(event: any): Promise<{ processed: boolean; duplicate?: boolean; error?: string }> {
    const eventId = event?.id || event?.event_id;
    if (!eventId) {
      return { processed: false, error: 'Missing event ID in webhook payload.' };
    }

    const processedSet = loadProcessedWebhooks();
    if (processedSet.has(eventId)) {
      return { processed: true, duplicate: true };
    }

    saveProcessedWebhook(eventId);

    const callId = event?.data?.call_id || event?.call_id || event?.data?.id;
    if (!callId) {
      return { processed: true };
    }

    // Refresh task progress upon webhook arrival
    await this.pollCallProgress(callId);
    return { processed: true };
  }
}

export const callService = new CallService();
