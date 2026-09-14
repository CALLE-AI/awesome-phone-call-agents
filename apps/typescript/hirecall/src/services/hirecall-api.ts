import type { Batch, Candidate } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export type RosterPayload = {
  batches: Batch[];
  inactiveBatches: Batch[];
  liveCallsEnabled: boolean;
};

export type UploadPayload = RosterPayload & {
  imported: number;
  skipped: number;
};

export type BatchDetail = {
  batch: Batch;
  candidates: Candidate[];
  liveCallsEnabled?: boolean;
};

export type PreparePayload = BatchDetail & {
  prepared?: number;
  failed?: number;
  skipped?: number;
  promptFailed?: number;
  promptSource?: "gemini" | "dry-run";
};

export type QueuePayload = BatchDetail & {
  queued?: number;
  failed?: number;
  started?: number;
};

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string) {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

const OPERATOR_TOKEN_KEY = "hirecall-operator-token";

export function getOperatorToken() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(OPERATOR_TOKEN_KEY)?.trim() ?? "";
}

export function setOperatorToken(token: string) {
  sessionStorage.setItem(OPERATOR_TOKEN_KEY, token.trim());
}

export function clearOperatorToken() {
  sessionStorage.removeItem(OPERATOR_TOKEN_KEY);
}

function withAuth(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  const token = getOperatorToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

async function requestJson<T>(url: string, init?: RequestInit, fallback = "Request failed"): Promise<T> {
  const response = await fetch(url, withAuth(init));
  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(errorMessage(body, fallback), response.status, body);
  }
  return body as T;
}

export const hirecallApi = {
  async listRoster(): Promise<RosterPayload> {
    const data = await requestJson<Partial<RosterPayload>>("/api/batches", undefined, "Could not load the roster.");
    return {
      batches: data.batches ?? [],
      inactiveBatches: data.inactiveBatches ?? [],
      liveCallsEnabled: data.liveCallsEnabled === true,
    };
  },

  async createJudgeTest(input: {
    phone: string;
    name?: string;
    jobRole?: string;
  }): Promise<UploadPayload & { batch: Batch; candidates: Candidate[] }> {
    const data = await requestJson<Partial<UploadPayload> & { batch?: Batch; candidates?: Candidate[] }>(
      "/api/batches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo: true, ...input }),
      },
      "Could not create the judge test.",
    );
    if (!data.batch) {
      throw new ApiError("Could not create the judge test.", 400);
    }
    return {
      imported: data.imported ?? 1,
      skipped: data.skipped ?? 0,
      batches: data.batches ?? [],
      inactiveBatches: data.inactiveBatches ?? [],
      liveCallsEnabled: data.liveCallsEnabled === true,
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async uploadWorkbook(file: File): Promise<UploadPayload> {
    const body = new FormData();
    body.set("file", file);
    const data = await requestJson<Partial<UploadPayload>>(
      "/api/batches",
      { method: "POST", body },
      "Upload failed.",
    );
    return {
      imported: data.imported ?? 0,
      skipped: data.skipped ?? 0,
      batches: data.batches ?? [],
      inactiveBatches: data.inactiveBatches ?? [],
      liveCallsEnabled: data.liveCallsEnabled === true,
    };
  },

  async deactivateAll(): Promise<RosterPayload> {
    const data = await requestJson<Partial<RosterPayload>>(
      "/api/batches",
      { method: "DELETE" },
      "Could not deactivate the roster.",
    );
    return {
      batches: data.batches ?? [],
      inactiveBatches: data.inactiveBatches ?? [],
      liveCallsEnabled: data.liveCallsEnabled === true,
    };
  },

  async getBatch(batchId: string): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}`,
      undefined,
      "Could not load this Excel batch.",
    );
    if (!data.batch) {
      throw new ApiError("Could not load this Excel batch.", 404);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
      liveCallsEnabled: data.liveCallsEnabled === true,
    };
  },

  async setBatchActive(batchId: string, active: boolean): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      },
      "Could not update this batch.",
    );
    if (!data.batch) {
      throw new ApiError("Could not update this batch.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async setBatchJobRole(batchId: string, jobRole: string): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRole }),
      },
      "Could not update the job role.",
    );
    if (!data.batch) {
      throw new ApiError("Could not update the job role.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async setBatchScoreCriteria(
    batchId: string,
    scoreCriteria: { passScore: number; selected: string[]; notes: string; autoDecision: boolean },
  ): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreCriteria }),
      },
      "Could not save scoring criteria.",
    );
    if (!data.batch) {
      throw new ApiError("Could not save scoring criteria.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async setBatchSystemPrompt(batchId: string, systemPrompt: string): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      },
      "Could not update the system prompt.",
    );
    if (!data.batch) {
      throw new ApiError("Could not update the system prompt.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async prepareResumes(
    batchId: string,
    input: { candidateId: string } | { allWithLinks: true },
  ): Promise<PreparePayload> {
    const data = await requestJson<Partial<PreparePayload>>(
      `/api/batches/${batchId}/resumes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      "Could not prepare the resume.",
    );
    return {
      prepared: data.prepared,
      failed: data.failed,
      skipped: data.skipped,
      promptFailed: data.promptFailed,
      promptSource: data.promptSource,
      batch: data.batch as Batch,
      candidates: data.candidates ?? [],
    };
  },

  async preparePrompts(
    batchId: string,
    input: { candidateId: string } | { allPending: true },
  ): Promise<PreparePayload> {
    const data = await requestJson<Partial<PreparePayload>>(
      `/api/batches/${batchId}/prompts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      "Could not write the call prompt.",
    );
    return {
      prepared: data.prepared,
      failed: data.failed,
      skipped: data.skipped,
      promptSource: data.promptSource,
      batch: data.batch as Batch,
      candidates: data.candidates ?? [],
    };
  },

  async queueCalls(
    batchId: string,
    input: { candidateId: string } | { allReady: true },
  ): Promise<QueuePayload> {
    const data = await requestJson<Partial<QueuePayload>>(
      `/api/batches/${batchId}/calls`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      "Could not place the call.",
    );
    return {
      queued: data.queued,
      failed: data.failed,
      started: data.started,
      batch: data.batch as Batch,
      candidates: data.candidates ?? [],
    };
  },

  async setCallDecision(
    batchId: string,
    candidateId: string,
    decision: "call_again" | "next_round" | "rejected",
  ): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}/calls`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, decision }),
      },
      "Could not save that decision.",
    );
    if (!data.batch) {
      throw new ApiError("Could not save that decision.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async updateCandidate(
    batchId: string,
    candidateId: string,
    patch: { name: string; phone: string; resumeUrl: string; consent: boolean; jobRole: string },
  ): Promise<BatchDetail> {
    const data = await requestJson<Partial<BatchDetail>>(
      `/api/batches/${batchId}/candidates/${candidateId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      "Could not update this candidate.",
    );
    if (!data.batch) {
      throw new ApiError("Could not update this candidate.", 400);
    }
    return {
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async updateWorkbook(batchId: string, file: File): Promise<BatchDetail & { updated: number; inserted: number; skipped: number }> {
    const body = new FormData();
    body.set("file", file);
    const data = await requestJson<Partial<BatchDetail> & { updated?: number; inserted?: number; skipped?: number }>(
      `/api/batches/${batchId}/workbook`,
      { method: "POST", body },
      "Could not update this Excel batch.",
    );
    if (!data.batch) {
      throw new ApiError("Could not update this Excel batch.", 400);
    }
    return {
      updated: data.updated ?? 0,
      inserted: data.inserted ?? 0,
      skipped: data.skipped ?? 0,
      batch: data.batch,
      candidates: data.candidates ?? [],
    };
  },

  async pingGemini(): Promise<{ reply: string; model: string }> {
    const data = await requestJson<{ reply?: string; model?: string }>(
      "/api/gemini/ping",
      { method: "POST" },
      "Gemini did not respond.",
    );
    if (!data.reply) {
      throw new ApiError("Gemini did not respond.", 400);
    }
    return {
      reply: data.reply,
      model: data.model ?? "gemini-3.6-flash",
    };
  },
};
