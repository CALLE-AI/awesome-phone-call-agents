import { getApiBaseUrl } from "@/constants/oauth";
import { describeNetworkError, errorMessageFromBody, parseJsonText } from "@/shared/http-json";

export type AppCall = {
  id: string;
  status: string;
  summary?: string | null;
  structured_result?: Record<string, unknown> | null;
  task?: string;
  evidence?: string[];
  task_completed?: boolean | null;
  completion_confidence?: number | null;
  recipients?: Array<{ id: string; status: string; structured_result?: Record<string, unknown> | null }>;
};

export class MobileCalleApi {
  constructor(
    private readonly baseUrl: string = getApiBaseUrl(),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        credentials: "include",
        ...init,
      });
    } catch (error) {
      throw new Error(describeNetworkError(error, fallback));
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(errorMessageFromBody(text, response.status, fallback));
    }
    return parseJsonText<T>(text, fallback);
  }

  async create(input: {
    task: string;
    phones: string[];
    clientRequestId: string;
    consent?: boolean;
    region?: string;
  }): Promise<AppCall> {
    if (!input.task.trim()) throw new Error("Create failed: task is required");
    if (!input.phones.length) throw new Error("Create failed: at least one phone is required");
    if (!input.clientRequestId.trim()) throw new Error("Create failed: clientRequestId is required");
    return this.request<AppCall>(
      "/api/calle/calls",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      "Create failed",
    );
  }

  async get(id: string): Promise<AppCall> {
    if (!id.trim()) throw new Error("Fetch failed: call id is required");
    return this.request<AppCall>(`/api/calle/calls/${encodeURIComponent(id)}`, undefined, "Fetch failed");
  }

  async reconcile(id: string): Promise<{ remote: AppCall; changed: boolean }> {
    if (!id.trim()) throw new Error("Reconcile failed: call id is required");
    return this.request<{ remote: AppCall; changed: boolean }>(
      `/api/calle/calls/${encodeURIComponent(id)}/reconcile`,
      { method: "POST" },
      "Reconcile failed",
    );
  }

  async health(): Promise<{ ok: boolean; mode?: string }> {
    return this.request<{ ok: boolean; mode?: string }>("/api/calle/health", undefined, "Health failed");
  }
}
