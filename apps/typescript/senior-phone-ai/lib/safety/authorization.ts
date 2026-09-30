import { randomUUID } from "node:crypto";

import { assertStrictE164, maskPhoneNumber, redactPhoneNumbers } from "./phone";

export const SIDE_EFFECT_ACTIONS = [
  "send_sms",
  "create_reminder",
  "contact_trusted_person",
  "place_outbound_call",
] as const;

export type SideEffectAction = (typeof SIDE_EFFECT_ACTIONS)[number];

export interface ActionRequest {
  readonly principalId: string;
  readonly seniorId: string;
  readonly action: SideEffectAction;
  readonly destinationE164: string;
  readonly purpose: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface PendingAction {
  readonly authorizationId: string;
  readonly action: SideEffectAction;
  readonly destinationSummary: string;
  readonly purposeSummary: string;
  readonly expiresAt: string;
}

export type AuthorizationDenial =
  | "denied"
  | "expired"
  | "mismatched"
  | "already-used";

export type AuthorizationDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: AuthorizationDenial }>;

interface StoredAuthorization {
  readonly authorizationId: string;
  readonly request: ActionRequest;
  readonly fingerprint: string;
  readonly expiresAtMs: number;
  state: "pending" | "confirmed" | "denied" | "consumed";
}

export interface ActionAuthorizationStore {
  propose(request: ActionRequest): PendingAction | Promise<PendingAction>;
  confirm(authorizationId: string, principalId: string, confirmed: boolean): AuthorizationDecision | Promise<AuthorizationDecision>;
  consume(authorizationId: string, request: ActionRequest): AuthorizationDecision | Promise<AuthorizationDecision>;
}

interface StoreOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const MAX_FIELD_LENGTH = 200;
const MAX_DETAIL_FIELDS = 12;
const SENSITIVE_DETAIL_KEY = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;

function requireBoundedField(name: string, value: string, maximum = MAX_FIELD_LENGTH): string {
  if (value.length < 1 || value.length > maximum || value.trim() !== value) {
    throw new Error(`${name} must be non-empty, bounded, and trimmed`);
  }
  return value;
}

export function validateActionRequest(request: ActionRequest): ActionRequest {
  requireBoundedField("principalId", request.principalId);
  requireBoundedField("seniorId", request.seniorId);
  requireBoundedField("purpose", request.purpose);
  assertStrictE164(request.destinationE164);
  const details = request.details ?? {};
  if (Object.keys(details).length > MAX_DETAIL_FIELDS) {
    throw new Error("action details contain too many fields");
  }
  for (const [key, value] of Object.entries(details)) {
    requireBoundedField("detail key", key, 64);
    requireBoundedField("detail value", value, 500);
    if (SENSITIVE_DETAIL_KEY.test(key)) {
      throw new Error("authentication data is not allowed in action details");
    }
  }
  return request;
}

function fingerprint(request: ActionRequest): string {
  const details = Object.entries(request.details ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify([
    request.principalId,
    request.seniorId,
    request.action,
    request.destinationE164,
    request.purpose,
    details,
  ]);
}

export class InMemoryActionAuthorizationStore implements ActionAuthorizationStore {
  private readonly records = new Map<string, StoredAuthorization>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly ttlMs: number;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) {
      throw new Error("authorization TTL must be a positive integer");
    }
  }

  propose(request: ActionRequest): PendingAction {
    const validated = validateActionRequest(request);
    const authorizationId = this.createId();
    const expiresAtMs = this.now() + this.ttlMs;
    this.records.set(authorizationId, {
      authorizationId,
      request: {
        ...validated,
        details: validated.details ? { ...validated.details } : undefined,
      },
      fingerprint: fingerprint(validated),
      expiresAtMs,
      state: "pending",
    });
    return {
      authorizationId,
      action: validated.action,
      destinationSummary: maskPhoneNumber(validated.destinationE164),
      purposeSummary: redactPhoneNumbers(validated.purpose),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  confirm(
    authorizationId: string,
    principalId: string,
    confirmed: boolean,
  ): AuthorizationDecision {
    const record = this.records.get(authorizationId);
    if (!record || record.request.principalId !== principalId || record.state !== "pending") {
      return { allowed: false, reason: "denied" };
    }
    if (this.now() >= record.expiresAtMs) {
      record.state = "denied";
      return { allowed: false, reason: "expired" };
    }
    if (!confirmed) {
      record.state = "denied";
      return { allowed: false, reason: "denied" };
    }
    record.state = "confirmed";
    return { allowed: true };
  }

  consume(authorizationId: string, request: ActionRequest): AuthorizationDecision {
    let validated: ActionRequest;
    try {
      validated = validateActionRequest(request);
    } catch {
      return { allowed: false, reason: "mismatched" };
    }
    const record = this.records.get(authorizationId);
    if (!record || record.state === "pending" || record.state === "denied") {
      return { allowed: false, reason: "denied" };
    }
    if (record.state === "consumed") {
      return { allowed: false, reason: "already-used" };
    }
    if (this.now() >= record.expiresAtMs) {
      record.state = "denied";
      return { allowed: false, reason: "expired" };
    }
    if (record.fingerprint !== fingerprint(validated)) {
      return { allowed: false, reason: "mismatched" };
    }
    record.state = "consumed";
    return { allowed: true };
  }
}
