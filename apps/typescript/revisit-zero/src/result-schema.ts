export const ANSWERS = ["YES", "NO", "UNKNOWN", "NOT_APPLICABLE"] as const;
export type ClosedAnswer = (typeof ANSWERS)[number];

export const CONTACT_OUTCOMES = ["REACHED", "UNREACHED", "DO_NOT_CONTACT"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export interface StructuredCallResult {
  schemaVersion: "1.0";
  contactOutcome: ContactOutcome;
  accessResolution: {
    gateUnlocked: ClosedAnswer;
    dogSecured: ClosedAnswer;
    obstructionRemoved: ClosedAnswer;
    presenceArranged: ClosedAnswer;
    externalAccessPartyResolved: ClosedAnswer;
  };
  selectedVisitWindowId: string | null;
  optOut: boolean;
}

export const NO_VISIT_WINDOW_SENTINEL = "NONE" as const;

const PROVIDER_TOP_LEVEL_KEYS = ["accessResolution", "contactOutcome", "schemaVersion", "selectedVisitWindowId"];
const PROVIDER_WIRE_ERROR = "PROVIDER_WIRE_SCHEMA_MISMATCH" as const;

export interface ProviderWireResultError {
  __revisitZeroProviderWireError: typeof PROVIDER_WIRE_ERROR;
}

/**
 * CALL-E accepts a deliberately small JSON Schema subset. This wire schema is
 * separate from the stricter local TypeScript/null model: null is represented
 * as the closed string sentinel NONE and normalized only after CALL-E returns.
 */
export function buildProviderRecipientResultSchema(approvedVisitWindowIds: readonly string[]): Record<string, unknown> {
  const windowIds = [...new Set(approvedVisitWindowIds)];
  if (
    windowIds.length === 0 ||
    windowIds.length !== approvedVisitWindowIds.length ||
    windowIds.some((id) => id.trim().length === 0 || id === NO_VISIT_WINDOW_SENTINEL)
  ) {
    throw new Error("Approved visit-window IDs must be non-empty, unique, and may not use the NONE sentinel");
  }
  const closedAnswer = { type: "string", enum: ANSWERS };
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "contactOutcome", "accessResolution", "selectedVisitWindowId"],
    properties: {
      schemaVersion: { type: "string", enum: ["1.0"] },
      contactOutcome: { type: "string", enum: CONTACT_OUTCOMES },
      accessResolution: {
        type: "object",
        additionalProperties: false,
        required: ["gateUnlocked", "dogSecured", "obstructionRemoved", "presenceArranged", "externalAccessPartyResolved"],
        properties: {
          gateUnlocked: closedAnswer,
          dogSecured: closedAnswer,
          obstructionRemoved: closedAnswer,
          presenceArranged: closedAnswer,
          externalAccessPartyResolved: closedAnswer,
        },
      },
      selectedVisitWindowId: { type: "string", enum: [...windowIds, NO_VISIT_WINDOW_SENTINEL] },
    },
  };
}

export function normalizeProviderStructuredResult(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const actualKeys = Object.keys(raw).sort();
  if (!sameKeys(actualKeys, PROVIDER_TOP_LEVEL_KEYS) || typeof raw.selectedVisitWindowId !== "string") {
    return providerWireResultError();
  }
  return {
    ...raw,
    selectedVisitWindowId: raw.selectedVisitWindowId === NO_VISIT_WINDOW_SENTINEL ? null : raw.selectedVisitWindowId,
    // The wire contract has one source of truth. This local convenience field
    // is derived rather than asking the provider to keep two fields in sync.
    optOut: raw.contactOutcome === "DO_NOT_CONTACT",
  };
}

export function isProviderWireResultError(raw: unknown): raw is ProviderWireResultError {
  return isPlainObject(raw) && raw.__revisitZeroProviderWireError === PROVIDER_WIRE_ERROR;
}

export function emptyUnreachedResult(): StructuredCallResult {
  return {
    schemaVersion: "1.0",
    contactOutcome: "UNREACHED",
    accessResolution: {
      gateUnlocked: "UNKNOWN",
      dogSecured: "UNKNOWN",
      obstructionRemoved: "UNKNOWN",
      presenceArranged: "UNKNOWN",
      externalAccessPartyResolved: "UNKNOWN",
    },
    selectedVisitWindowId: null,
    optOut: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function providerWireResultError(): ProviderWireResultError {
  return { __revisitZeroProviderWireError: PROVIDER_WIRE_ERROR };
}

function sameKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key);
}
