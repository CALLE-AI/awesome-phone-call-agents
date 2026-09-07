// CALL-E integration service — the ONLY place CALL-E specifics live.
// Production path uses the real official SDK (@call-e/calle) at runtime,
// with a raw REST fallback to the Developer API. Mock is used ONLY when
// explicitly requested (demo mode / missing credentials) and is labeled.

import type { ExecutionPlan, MissionInput } from "@/types";

export interface CalleCallRequest {
  task: string;
  phoneE164: string;
  targetName: string;
  instructions: string;
  resultSchema: Record<string, unknown>;
  webhookUrl?: string;
}

export interface CalleCallResult {
  provider: "calle-live" | "calle-mock";
  callId: string;
  runId: string | null;
  status: string;
  taskCompleted: boolean | null;
  confidence: number | null;
  structured: Record<string, unknown> | null;
  evidence: string[];
  transcript: { speaker: string; text: string; offset_seconds: number }[];
  raw: unknown;
}

export interface ICallEProvider {
  name: "calle-live" | "calle-mock";
  isConfigured(): boolean;
  /** One-shot: start and wait until terminal. */
  createCall(req: CalleCallRequest): Promise<CalleCallResult>;
  /** Non-blocking start — returns real CALL-E ids. Live provider only. */
  beginCall?(req: CalleCallRequest): Promise<{ callId: string; runId: string | null }>;
  /** Honest status snapshot for a live call. Live provider only. */
  fetchCall?(callId: string): Promise<CalleCallResult | null>;
  getCall(callId: string): Promise<CalleCallResult | null>;
}

const BASE_URL = process.env.CALLE_BASE_URL || "https://api.heycall-e.com";
const API_KEY = process.env.CALLE_API_KEY || "";

export function calleConfigured(): boolean {
  return API_KEY.length > 8;
}

function buildTaskText(input: MissionInput, plan: ExecutionPlan): string {
  return [
    `Call ${input.phoneE164} (${input.targetName}).`,
    `Goal: ${plan.objective}.`,
    plan.agentInstructions,
  ].join("\n");
}

// ---------- Real provider: official SDK first, REST fallback ----------
type SdkCalls = {
  create?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createAndWait?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  get?: (id: string) => Promise<Record<string, unknown>>;
};

async function loadSdkCalls(): Promise<{ client: { calls: SdkCalls }; via: "sdk" } | null> {
  try {
    const mod = await import("@call-e/calle").catch(() => null);
    const CalleClient = (mod as Record<string, unknown> | null)?.["CalleClient"] as
      | (new (opts: { apiKey: string; baseUrl?: string }) => { calls: SdkCalls })
      | undefined;
    if (!CalleClient) return null;
    return { client: new CalleClient({ apiKey: API_KEY, baseUrl: BASE_URL }), via: "sdk" };
  } catch {
    return null;
  }
}

function restBody(req: CalleCallRequest, snake: boolean) {
  return snake
    ? { task: req.task, recipients: [{ phones: [req.phoneE164] }], result_schema: req.resultSchema, ...(req.webhookUrl ? { webhook_url: req.webhookUrl } : {}) }
    : { task: req.task, recipients: [{ phones: [req.phoneE164] }], resultSchema: req.resultSchema, ...(req.webhookUrl ? { webhookUrl: req.webhookUrl } : {}) };
}

function extractIds(data: Record<string, unknown>): { callId: string; runId: string | null } {
  const pick = (...keys: string[]) => { for (const k of keys) if (data[k] !== undefined) return data[k]; return undefined; };
  return {
    callId: String(pick("id", "callId", "call_id") ?? `call_${Date.now()}`),
    runId: (pick("runId", "run_id") as string | undefined) ?? null,
  };
}

export function isTerminalStatus(status: string, data: Record<string, unknown>): boolean {
  if (/^(completed|failed|terminal|done)$/i.test(status)) {
    return data["structured_result"] !== undefined || data["structuredResult"] !== undefined || data["result"] !== undefined || /failed/i.test(status);
  }
  return false;
}

class RealCalleProvider implements ICallEProvider {
  name = "calle-live" as const;
  isConfigured() { return calleConfigured(); }

  /** Non-blocking start via SDK `calls.create`, else REST `POST /v1/calls`. */
  async beginCall(req: CalleCallRequest): Promise<{ callId: string; runId: string | null }> {
    if (!this.isConfigured()) throw new Error("CALLE_API_KEY is not configured");
    const sdk = await loadSdkCalls();
    if (sdk?.client.calls.create) {
      try {
        const data = await sdk.client.calls.create(restBody(req, false));
        return extractIds(data);
      } catch (e) {
        console.warn("[calle] SDK create failed, trying REST:", (e as Error).message);
      }
    } else if (sdk) {
      console.warn("[calle] SDK has no calls.create; using REST for non-blocking start");
    }
    const res = await fetch(`${BASE_URL}/v1/calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(restBody(req, true)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CALL-E API ${res.status}: ${text.slice(0, 400) || res.statusText}`);
    }
    return extractIds((await res.json()) as Record<string, unknown>);
  }

  /** Status snapshot via SDK `calls.get`, else REST `GET /v1/calls/{id}`. */
  async fetchCall(callId: string): Promise<CalleCallResult | null> {
    if (!this.isConfigured()) return null;
    const sdk = await loadSdkCalls().catch(() => null);
    if (sdk?.client.calls.get) {
      try {
        return normalizeSdkResult(await sdk.client.calls.get(callId));
      } catch (e) {
        console.warn("[calle] SDK get failed, trying REST:", (e as Error).message);
      }
    }
    return this.getCall(callId);
  }

  /** One-shot: SDK `calls.createAndWait`, else begin + poll. */
  async createCall(req: CalleCallRequest): Promise<CalleCallResult> {
    if (!this.isConfigured()) throw new Error("CALLE_API_KEY is not configured");
    const sdk = await loadSdkCalls();
    if (sdk?.client.calls.createAndWait) {
      try {
        // Official one-shot path: `CalleClient` / `client.calls.createAndWait`
        const call = await sdk.client.calls.createAndWait(restBody(req, false));
        return normalizeSdkResult(call);
      } catch (e) {
        console.warn("[calle] SDK createAndWait failed, trying REST:", (e as Error).message);
      }
    }
    const started = await this.beginCall(req);
    const terminal = await this.pollTerminal(started.callId, null);
    if (terminal) return normalizeSdkResult(terminal);
    const last = await this.fetchCall(started.callId);
    if (last) return last;
    throw new Error(`CALL-E call ${started.callId} did not reach a terminal state (poll timed out)`);
  }

  /** Poll until terminal. onSnapshot receives every honest snapshot (for live event feed). */
  async pollTerminal(
    callId: string,
    first: Record<string, unknown> | null,
    onSnapshot?: (snap: CalleCallResult) => void,
    opts?: { intervalMs?: number; maxPolls?: number }
  ): Promise<Record<string, unknown> | null> {
    const intervalMs = opts?.intervalMs ?? 5000;
    const maxPolls = opts?.maxPolls ?? 60;
    let cur: Record<string, unknown> | null = first;
    for (let i = 0; i < maxPolls; i++) {
      try {
        const snap = await this.fetchCall(callId);
        if (snap) {
          onSnapshot?.(snap);
          cur = snap.raw as Record<string, unknown>;
          if (isTerminalStatus(snap.status, cur)) return cur;
        }
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return cur;
  }

  async getCall(callId: string): Promise<CalleCallResult | null> {
    if (!this.isConfigured()) return null;
    const res = await fetch(`${BASE_URL}/v1/calls/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return normalizeSdkResult((await res.json()) as Record<string, unknown>);
  }
}

export function normalizeSdkResult(call: Record<string, unknown>): CalleCallResult {
  const pick = (...keys: string[]) => { for (const k of keys) if (call[k] !== undefined) return call[k]; return undefined; };
  const status = String(pick("status") ?? "completed");
  const taskCompleted = (pick("taskCompleted", "task_completed") as boolean | null) ?? null;
  const confRaw = pick("completionConfidence", "completion_confidence") as { score?: number } | number | undefined;
  const confidence = typeof confRaw === "number" ? confRaw : typeof confRaw?.score === "number" ? confRaw.score : null;
  const structured = (pick("structuredResult", "structured_result", "result") as Record<string, unknown> | null) ?? null;
  const evidence = (pick("evidence") as string[] | undefined) ?? [];
  const recipients = (pick("recipients") as Array<Record<string, unknown>> | undefined) ?? [];
  const transcript: CalleCallResult["transcript"] = [];
  for (const r of recipients) {
    const attempts = (r["attempts"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const a of attempts) {
      const turns = (a["transcript_turns"] as CalleCallResult["transcript"] | undefined) ?? (a["transcriptTurns"] as CalleCallResult["transcript"] | undefined) ?? [];
      for (const t of turns) transcript.push(t);
    }
  }
  return {
    provider: "calle-live",
    callId: String(pick("id", "callId", "call_id") ?? `call_${Date.now()}`),
    runId: (pick("runId", "run_id") as string | undefined) ?? null,
    status, taskCompleted, confidence, structured, evidence, transcript, raw: call,
  };
}

// ---------- Mock provider: clearly-labeled demo only ----------
class MockCalleProvider implements ICallEProvider {
  name = "calle-mock" as const;
  isConfigured() { return true; }
  async createCall(req: CalleCallRequest): Promise<CalleCallResult> {
    await new Promise((r) => setTimeout(r, 1200));
    return {
      provider: "calle-mock",
      callId: `mock_${Date.now().toString(36)}`,
      runId: null,
      status: "completed",
      taskCompleted: true,
      confidence: 0.81,
      structured: {
        objective_achieved: true,
        availability: [{ date: "Example Date", time: "Example Time" }],
        price: null,
        requirements: ["Booking name and callback number"],
        notes: [`Demo transcript for ${req.targetName}: asked about availability, earliest afternoon option noted.`],
        next_action: "User approval required before confirming",
      },
      evidence: ["MOCKED — no real phone call was placed."],
      transcript: [
        { speaker: "bot", text: "Hi, I'm CallPilot, an AI assistant calling on behalf of our user about availability.", offset_seconds: 0 },
        { speaker: "user", text: "Sure — earliest afternoon opening is Example Date at Example Time.", offset_seconds: 6 },
        { speaker: "bot", text: "Thanks! What do you need to hold that option?", offset_seconds: 12 },
        { speaker: "user", text: "Just a name and callback number; nothing is confirmed.", offset_seconds: 18 },
      ],
      raw: { mocked: true },
    };
  }
  async getCall(): Promise<CalleCallResult | null> { return null; }
}

export function getCalleProvider(opts: { demoMode: boolean }): ICallEProvider {
  if (opts.demoMode || !calleConfigured()) return new MockCalleProvider();
  return new RealCalleProvider();
}

export function buildCalleTask(input: MissionInput, plan: ExecutionPlan): string {
  return buildTaskText(input, plan);
}
