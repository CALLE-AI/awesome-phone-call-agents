import type { CaseRecord, Plan, SessionInfo } from './domain/model';
import type { CheckProgress } from './domain/progress';
export type CaseDetail = CaseRecord & { plans: Plan[] };
export interface CaseSummary {
  id: string;
  title: string;
  mode: CaseRecord['mode'];
  updatedAt: string;
  currentVersion: number;
  template: 'repair' | 'rental' | 'venue';
  resultCount: number;
  outcome: string | null;
  progress?: CheckProgress;
}
let csrf = '';
export function setSession(session: SessionInfo) {
  csrf = session.csrf;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data as T;
}
