import { CalleClient, type Call, type CreateCallInput } from "@call-e/calle";
import type { Role } from "./contracts.js";

export interface StartRequest {
  role: Role;
  phone: string;
  objective: string;
  resultSchema: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}

export interface ProviderResult {
  status: string;
  structuredResult?: Readonly<Record<string, unknown>>;
  failureCode?: string;
}

export interface CallProvider {
  readonly mode: "sandbox" | "live";
  start(request: StartRequest): Promise<{ id: string }>;
  get(id: string): Promise<ProviderResult>;
}

export class SandboxProvider implements CallProvider {
  readonly mode = "sandbox" as const;
  readonly starts: StartRequest[] = [];
  readonly gets: string[] = [];
  private readonly roles = new Map<string, Role>();

  async start(request: StartRequest): Promise<{ id: string }> {
    this.starts.push(structuredClone(request));
    const id = `fixture-${this.starts.length}`;
    this.roles.set(id, request.role);
    return { id };
  }

  async get(id: string): Promise<ProviderResult> {
    this.gets.push(id);
    const role = this.roles.get(id);
    if (role === "facility") return {
      status: "completed",
      structuredResult: {
        outcome: "confirmed",
        original_practice_time: "4:30 PM",
        original_practice_possible: false,
        field_available_time: "5:30 PM",
        player_arrival_time: "5:00 PM",
        conflict_reason: "another school event is using the stadium",
        unresolved_questions: [],
        commitment_requests: ["Provide a volunteer to run the clock"],
      },
    };
    if (role === "parent") return {
      status: "completed",
      structuredResult: {
        outcome: "response_collected",
        attendance: "attending",
        transportation_needed: false,
        coach_follow_up_requested: false,
      },
    };
    throw new Error("Unknown sandbox call.");
  }
}

export class LiveProvider implements CallProvider {
  readonly mode = "live" as const;
  private readonly calls;

  constructor(apiKey: string) {
    if (!/^iams_live_[\x21-\x7e]+$/.test(apiKey)) throw new Error("CALLE_API_KEY must be a complete CALL-E project key.");
    this.calls = new CalleClient({ apiKey, baseUrl: "https://api.heycall-e.com" }).calls;
  }

  async start(request: StartRequest): Promise<{ id: string }> {
    let call: Call;
    try {
      call = await this.calls.create({
        task: request.objective,
        recipients: [{ phones: [request.phone], region: "US", locale: "en-US" }],
        recipientResultSchema: request.resultSchema as CreateCallInput["recipientResultSchema"],
        metadata: { app: "teamline", task_type: request.role },
      }, { idempotencyKey: request.idempotencyKey });
    } catch {
      throw new Error("CALL-E did not accept the call. No automatic retry occurred.");
    }
    return { id: call.id };
  }

  async get(id: string): Promise<ProviderResult> {
    let call: Call;
    try {
      call = await this.calls.get(id);
    } catch {
      throw new Error("CALL-E result retrieval failed. The existing call was not restarted.");
    }
    const failureCode = call.failureCode
      ?? call.recipients.flatMap((recipient) => recipient.attempts).find((attempt) => attempt.failureCode)?.failureCode;
    return {
      status: call.status,
      ...(call.recipients[0]?.structuredResult ? { structuredResult: call.recipients[0].structuredResult } : {}),
      ...(failureCode ? { failureCode } : {}),
    };
  }
}
