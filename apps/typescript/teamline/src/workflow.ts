import { createHash, randomUUID } from "node:crypto";
import { facilityObjective, facilityResultSchema, parentObjective, parentResultSchema, type Role } from "./contracts.js";
import { CallCreateError, type CallProvider, type ProviderResult, type StartRequest } from "./provider.js";

type AttemptStatus = "dispatching" | "create_uncertain" | "in_progress" | "completed" | "no_answer" | "failed";

interface Attempt {
  intentKey: string;
  phoneFingerprint: string;
  providerCallId?: string;
  phoneLastFour: string;
  status: AttemptStatus;
  previousNoAnswerAttempts: number;
  previousAttempt?: Attempt;
  result?: Readonly<Record<string, unknown>>;
}

type PublicAttempt = Omit<Attempt, "intentKey" | "phoneFingerprint" | "providerCallId" | "previousAttempt">;

export interface PublicState {
  mode: "sandbox" | "live";
  decision: "locked" | "awaiting_coach" | "approved";
  facility?: PublicAttempt;
  parent?: PublicAttempt;
}

const noConversationCodes = new Set(["no_answer", "not_answered", "voicemail", "voicemail_detected", "answering_machine", "answering_machine_detected", "no_conversation"]);

export class TeamLineWorkflow {
  private facility?: Attempt;
  private parent?: Attempt;
  private decision: PublicState["decision"] = "locked";
  private readonly active = new Set<string>();
  private readonly lastStart = new Map<Role, number>();

  constructor(
    private readonly provider: CallProvider,
    private readonly now: () => number = Date.now,
    private readonly createIntentId: () => string = randomUUID,
  ) {}

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

  reconcileFacility(input: LaunchInput): Promise<PublicState> {
    return this.reconcile("facility", input);
  }

  launchParent(input: LaunchInput): Promise<PublicState> {
    return this.launch("parent", input, false);
  }

  retryParent(input: LaunchInput): Promise<PublicState> {
    return this.launch("parent", input, true);
  }

  reconcileParent(input: LaunchInput): Promise<PublicState> {
    return this.reconcile("parent", input);
  }

  async check(role: Role): Promise<PublicState> {
    const attempt = this.attempt(role);
    if (attempt.status === "create_uncertain") throw new Error("Reconcile the existing call intent before checking a result.");
    if (attempt.status !== "in_progress") return this.state();
    if (!attempt.providerCallId) throw new Error("The existing call intent has no provider result to check.");
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
    const current = role === "facility" ? this.facility : this.parent;
    const reservation = `start:${role}`;
    if (this.active.has(reservation)) throw new Error("That call is already being submitted.");
    if (role === "parent" && this.decision !== "approved") throw new Error("The parent call is locked until the coach approves the facility result.");
    if (retry && current?.status !== "no_answer") throw new Error("Only a provider-confirmed no-answer call can be retried.");
    if (!retry && current) throw new Error("This call already exists. Check its result instead of starting another call.");
    const previousStart = this.lastStart.get(role);
    if (previousStart !== undefined && this.now() - previousStart < 10_000) throw new Error("Wait 10 seconds before starting another attempt.");
    this.active.add(reservation);
    this.lastStart.set(role, this.now());
    const attempt: Attempt = {
      intentKey: `teamline-${role}-${this.createIntentId()}`,
      phoneFingerprint: fingerprint(phone),
      phoneLastFour: phone.slice(-4),
      status: "dispatching",
      previousNoAnswerAttempts: retry ? current!.previousNoAnswerAttempts + 1 : 0,
      ...(retry ? { previousAttempt: current } : {}),
    };
    this.setAttempt(role, attempt);
    try {
      await this.dispatch(role, phone, attempt);
      return this.state();
    } catch (error) {
      if (error instanceof CallCreateError && error.outcome === "not_created") {
        this.setAttempt(role, current);
        throw error;
      }
      attempt.status = "create_uncertain";
      throw new Error("CALL-E may have accepted this call, but TeamLine did not receive a definitive response. Reconcile this same call intent; do not start a new call.");
    } finally {
      this.active.delete(reservation);
    }
  }

  private async reconcile(role: Role, input: LaunchInput): Promise<PublicState> {
    requireConsent(input.consent);
    const phone = normalizePhone(input.phone);
    const attempt = this.attempt(role);
    if (attempt.status !== "create_uncertain") throw new Error("Only an unresolved call-creation intent can be reconciled.");
    if (attempt.phoneFingerprint !== fingerprint(phone)) throw new Error("Re-enter the same authorized phone number to reconcile this call intent.");
    const reservation = `start:${role}`;
    if (this.active.has(reservation)) throw new Error("That call intent is already being reconciled.");
    this.active.add(reservation);
    attempt.status = "dispatching";
    try {
      await this.dispatch(role, phone, attempt);
      return this.state();
    } catch (error) {
      if (error instanceof CallCreateError && error.outcome === "not_created") {
        this.setAttempt(role, attempt.previousAttempt);
        throw error;
      }
      attempt.status = "create_uncertain";
      throw new Error("The same CALL-E call intent remains unresolved. TeamLine will not create a new logical call or redial automatically.");
    } finally {
      this.active.delete(reservation);
    }
  }

  private async dispatch(role: Role, phone: string, attempt: Attempt): Promise<void> {
    const started = await this.provider.start(this.startRequest(role, phone, attempt.intentKey));
    if (!started?.id) throw new CallCreateError("ambiguous", "The provider returned an ambiguous create response.");
    attempt.providerCallId = started.id;
    attempt.status = "in_progress";
    delete attempt.previousAttempt;
  }

  private startRequest(role: Role, phone: string, intentKey: string): StartRequest {
    return role === "facility" ? {
      role, phone, objective: facilityObjective, resultSchema: facilityResultSchema, idempotencyKey: intentKey,
    } : {
      role, phone, objective: parentObjective(this.approvedChange()), resultSchema: parentResultSchema, idempotencyKey: intentKey,
    };
  }

  private setAttempt(role: Role, attempt: Attempt | undefined): void {
    if (role === "facility") this.facility = attempt;
    else this.parent = attempt;
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

function publicAttempt(attempt: Attempt): PublicAttempt {
  const {
    providerCallId: _providerCallId,
    intentKey: _intentKey,
    phoneFingerprint: _phoneFingerprint,
    previousAttempt: _previousAttempt,
    ...safe
  } = attempt;
  return structuredClone(safe);
}

function fingerprint(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
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
