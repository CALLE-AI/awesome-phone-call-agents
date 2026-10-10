import { cookies } from 'next/headers';
import type {
  SessionUser,
  TaskListResponse,
  TaskDetail,
  UserSettings,
  Contact,
} from '@dial/schemas';

/**
 * Server-side data loading. Runs on the Next.js server with the user's cookie,
 * so the first paint already carries real data instead of a loading shell.
 */
const API_URL = process.env['SERVER_API_URL'] ?? 'http://localhost:4000';

async function serverFetch<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { cookie: header, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const result = await serverFetch<{ user: SessionUser }>('/api/auth/me');
  return result?.user ?? null;
}

export function getTasks(): Promise<TaskListResponse | null> {
  return serverFetch<TaskListResponse>('/api/tasks');
}

export function getTask(id: string): Promise<TaskDetail | null> {
  return serverFetch<TaskDetail>(`/api/tasks/${encodeURIComponent(id)}`);
}

export function getSettings(): Promise<UserSettings | null> {
  return serverFetch<UserSettings>('/api/settings');
}

export function getContacts(): Promise<{ contacts: Contact[] } | null> {
  return serverFetch<{ contacts: Contact[] }>('/api/contacts');
}
