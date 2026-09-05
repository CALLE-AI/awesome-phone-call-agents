import type { AppState, FakeOutcome, Preview, WorkflowType } from "./types";

const origin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/+$/, "") || "";
const apiToken = (import.meta.env.VITE_EMPLOYE_API_TOKEN as string | undefined)?.trim() || "";
const endpoint = (path: string) => `${origin}/api${path}`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(endpoint(path), { ...init, headers: { "content-type": "application/json", ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}), ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof body?.error === "string" ? body.error : `Request failed (${response.status})`, response.status);
  return body as T;
};

const post = <T>(path: string, body: Record<string, unknown> = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const getState = () => request<AppState>("/state");
export const resetState = () => post<AppState>("/reset");
export const configureLiveWorkspace = (input: Record<string, unknown>) => post<AppState>("/live/workspace", input);
export const previewJob = (input: Record<string, unknown>) => post<Preview>("/jobs/preview", input);
export const createJob = (input: Record<string, unknown>) => post<AppState>("/jobs", input);
export const jobAction = (id: string, action: string) => post<AppState>(`/jobs/${encodeURIComponent(id)}/${action}`);
export const createJobInput = (employeeId: string, shiftId: string, proposedDate: string, proposedTime: string, fakeOutcome: FakeOutcome, workflowType: WorkflowType) => ({ employeeId, shiftId, proposedDate, proposedTime, fakeOutcome, workflowType });
