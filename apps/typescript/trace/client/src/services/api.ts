import {
  CallRecord,
  DigitalClaim,
  PhoneTarget,
  VerificationQuestion,
  VerificationStats,
  VerificationTask,
} from '../types/index.js';

export interface HealthResponse {
  status: string;
  version: string;
  mode: 'LIVE' | 'MOCK';
  hasApiKey: boolean;
  isMockConfigured: boolean;
  system: string;
}

export interface CreateTaskPayload {
  target: PhoneTarget;
  subject: string;
  verificationGoal: string;
  questions: VerificationQuestion[];
  digitalClaim?: DigitalClaim;
}

export const api = {
  /**
   * Health & environment status check
   */
  async getHealth(): Promise<HealthResponse> {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('Failed to fetch system health.');
    return res.json();
  },

  /**
   * Switch telephony provider mode
   */
  async setMode(mode: 'LIVE' | 'MOCK'): Promise<{ success: boolean; mode: 'LIVE' | 'MOCK'; message: string }> {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to switch to ${mode} mode.`);
    }
    return res.json();
  },

  /**
   * Fetch all verification tasks and calculated metrics
   */
  async getTasks(): Promise<{ tasks: VerificationTask[]; stats: VerificationStats }> {
    const res = await fetch('/api/tasks');
    if (!res.ok) throw new Error('Failed to fetch verification tasks.');
    return res.json();
  },

  /**
   * Create a new custom verification task
   */
  async createTask(payload: CreateTaskPayload): Promise<VerificationTask> {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create verification task.');
    }
    return res.json();
  },

  /**
   * Get single verification task details
   */
  async getTask(id: string): Promise<VerificationTask> {
    const res = await fetch(`/api/tasks/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch task ${id}.`);
    return res.json();
  },

  /**
   * Delete verification task
   */
  async deleteTask(id: string): Promise<boolean> {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete task ${id}.`);
    return true;
  },

  /**
   * Trigger phone verification call for a task
   */
  async verifyTask(taskId: string, forceMock = false): Promise<VerificationTask> {
    const res = await fetch(`/api/tasks/${taskId}/verify${forceMock ? '?mock=true' : ''}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to verify task ${taskId}.`);
    }
    return res.json();
  },

  /**
   * Trigger batch verification across all pending tasks
   */
  async verifyAll(): Promise<{ triggered: number; tasks: VerificationTask[]; stats: VerificationStats }> {
    const res = await fetch('/api/tasks/verify-all', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to trigger batch verification.');
    }
    return res.json();
  },

  /**
   * Poll live call progress and real-time transcripts
   */
  async getCallProgress(
    callId: string,
    taskId?: string
  ): Promise<{ task: VerificationTask; record: CallRecord }> {
    const url = `/api/calls/${callId}${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch live call status for ${callId}.`);
    return res.json();
  },

  /**
   * Load safe generic demo benchmark scenarios
   */
  async loadDemoCampaign(): Promise<{ tasks: VerificationTask[]; stats: VerificationStats }> {
    const res = await fetch('/api/demo/load', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to load demo campaign.');
    return res.json();
  },

  /**
   * Clear all tasks
   */
  async clearTasks(): Promise<{ tasks: VerificationTask[]; stats: VerificationStats }> {
    const res = await fetch('/api/demo/clear', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear tasks.');
    return res.json();
  },

  /**
   * URLs for direct downloads
   */
  exportExcelUrl: '/api/tasks/export.xlsx',
  exportTaskExcelUrl: (id: string) => `/api/tasks/${id}/export.xlsx`,
  exportCsvUrl: '/api/tasks/export.csv',
};
