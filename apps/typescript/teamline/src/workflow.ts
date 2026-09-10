import { facilityObjective, facilityResultSchema, parentObjective, parentResultSchema, type Role } from "./contracts.js";
import type { CallProvider, ProviderResult } from "./provider.js";

type AttemptStatus = "in_progress" | "completed" | "no_answer" | "failed";

interface Attempt {
  providerCallId: string;
  phoneLastFour: string;
  status: AttemptStatus;
  previousNoAnswerAttempts: number;
  result?: Readonly<Record<string, unknown>>;
}

export interface PublicState {
  mode: "sandbox" | "live";
  decision: "locked" | "awaiting_coach" | "approved";
  facility?: Omit<Attempt, "providerCallId">;
  parent?: Omit<Attempt, "providerCallId">;
}

const noConversationCodes = new Set(["no_answer", "not_answered", "voicemail", "voicemail_detected", "answering_machine", "answering_machine_detected", "no_conversation"]);

export class TeamLineWorkflow {
  private facility?: Attempt;
  private parent?: Attempt;
  private decision: PublicState["decision"] = "locked";
  private readonly active = new Set<string>();
  private readonly lastStart = new Map<Role, number>();

  constructor(private readonly provider: CallProvider, private readonly now: () => number = Date.now) {}

  state(): PublicState {
    return {
      mode: this.provider.mode,
      decision: this.decision,
      ...(this.facility ? { facility: publicAttempt(this.facility) } : {}),
      ...(this.parent ? { parent: publicAttempt(this.parent) } : {}),
    };
  }

  launchFacility(input: LaunchInput): Promise<PublicState> {
    return this.launch("facility", input, false);
  }

  retryFacility(input: LaunchInput): Promise<PublicState> {
    return this.launch("facility", input, true);
  }

  launchParent(input: LaunchInput): Promise<PublicState> {
    return this.launch("parent", input, false);
  }

  retryParent(input: LaunchInput): Promise<PublicState> {
    return this.launch("parent", input, true);
  }

  async check(role: Role): Promise<PublicState> {
    const attempt = this.attempt(role);
    if (attempt.status !== "in_progress") return this.state();
    const reservation = `check:${role}`;
    if (this.active.has(reservation)) throw new Error("That result is already being checked.");
    this.active.add(reservation);
    try {
      const result = await this.provider.get(attempt.providerCallId);
      this.applyResult(role, attempt, result);
      return this.state();
    } finally {
      this.active.delete(reservation);
    }
  }

  approveFacilityDecision(): PublicState {
    if (this.decision !== "awaiting_coach") throw new Error("A complete facility result is required before coach approval.");
    this.decision = "approved";
    return this.state();
  }

  private async launch(role: Role, input: LaunchInput, retry: boolean): Promise<PublicState> {
    requireConsent(input.consent);
    const phone = normalizePhone(input.phone);
    if (!/^[A-Za-z0-9-]{8,100}$/.test(input.idempotencyKey)) throw new Error("A stable idempotency key is required.");
    const current = role === "facility" ? this.facility : this.parent;
    if (role === "parent" && this.decision !== "approved") throw new Error("The parent call is locked until the coach approves the facility result.");
    if (retry && current?.status !== "no_answer") throw new Error("Only a provider-confirmed no-answer call can be retried.");
    if (!retry && current) throw new Error("This call already exists. Check its result instead of starting another call.");
    const reservation = `start:${role}`;
    if (this.active.has(reservation)) throw new Error("That call is already being submitted.");
    const previousStart = this.lastStart.get(role);
    if (previousStart !== undefined && this.now() - previousStart < 10_000) throw new Error("Wait 10 seconds before starting another attempt.");
    this.active.add(reservation);
    this.lastStart.set(role, this.now());
    try {
      const request = role === "facility" ? {
        role, phone, objective: facilityObjective, resultSchema: facilityResultSchema, idempotencyKey: input.idempotencyKey,
      } : {
        role, phone, objective: parentObjective(this.approvedChange()), resultSchema: parentResultSchema, idempotencyKey: input.idempotencyKey,
      };
      const started = await this.provider.start(request);
      const attempt: Attempt = {
        providerCallId: started.id,
        phoneLastFour: phone.slice(-4),
        status: "in_progress",
        previousNoAnswerAttempts: retry ? current!.previousNoAnswerAttempts + 1 : 0,
      };
      if (role === "facility") this.facility = attempt;
      else this.parent = attempt;
      return this.state();
    } finally {
      this.active.delete(reservation);
    }
  }

  private applyResult(role: Role, attempt: Attempt, providerResult: ProviderResult): void {
    if (providerResult.status === "queued" || providerResult.status === "in_progress") return;
    const outcome = providerResult.structuredResult?.outcome;
    const code = providerResult.failureCode?.toLowerCase().replaceAll("-", "_");
    if (outcome === "no_answer" || (code && noConversationCodes.has(code))) {
      attempt.status = "no_answer";
      return;
    }
    if (providerResult.status === "failed" || providerResult.status === "canceled") {
      attempt.status = "failed";
      return;
    }
    attempt.result = sanitizeResult(role, providerResult.structuredResult ?? {});
    attempt.status = "completed";
    if (role === "facility") this.decision = facilityIsApprovable(attempt.result) ? "awaiting_coach" : "locked";
  }

  private approvedChange(): { from: string; to: string; arrival: string; reason: string } {
    if (this.decision !== "approved" || !this.facility?.result) throw new Error("No coach-approved practice change exists.");
    return {
      from: String(this.facility.result.original_practice_time),
      to: String(this.facility.result.field_available_time),
      arrival: String(this.facility.result.player_arrival_time),
      reason: String(this.facility.result.conflict_reason),
    };
  }

  private attempt(role: Role): Attempt {
    const attempt = role === "facility" ? this.facility : this.parent;
    if (!attempt) throw new Error("No call exists for that role.");
    return attempt;
  }
}

export interface LaunchInput {
  phone: string;
  consent: boolean;
  idempotencyKey: string;
}

export function normalizePhone(value: string): string {
  const digits = value.trim().replace(/[\s().-]/g, "");
  const normalized = digits.startsWith("+") ? digits : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
  if (!/^\+1[2-9]\d{9}$/.test(normalized)) throw new Error("Enter a valid US phone number with area code.");
  return normalized;
}

function requireConsent(value: boolean): void {
  if (value !== true) throw new Error("Explicit consent is required before a call attempt.");
}

function publicAttempt(attempt: Attempt): Omit<Attempt, "providerCallId"> {
  const { providerCallId: _providerCallId, ...safe } = attempt;
  return structuredClone(safe);
}

function sanitizeResult(role: Role, value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  const allowed = role === "facility"
    ? new Set(["outcome", "original_practice_time", "original_practice_possible", "field_available_time", "player_arrival_time", "conflict_reason", "unresolved_questions", "commitment_requests"])
    : new Set(["outcome", "attendance", "transportation_needed", "coach_follow_up_requested"]);
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (typeof item === "boolean" || item === null) safe[key] = item;
    else if (typeof item === "string") safe[key] = safeText(item);
    else if (Array.isArray(item)) safe[key] = item.filter((entry): entry is string => typeof entry === "string").map(safeText).slice(0, 8);
  }
  return safe;
}

function safeText(value: string): string {
  return value.replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[masked phone]").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
}

function facilityIsApprovable(result: Readonly<Record<string, unknown>>): boolean {
  return result.outcome === "confirmed"
    && result.original_practice_possible === false
    && typeof result.original_practice_time === "string"
    && typeof result.field_available_time === "string"
    && typeof result.player_arrival_time === "string"
    && typeof result.conflict_reason === "string"
    && Array.isArray(result.unresolved_questions)
    && result.unresolved_questions.length === 0;
}
