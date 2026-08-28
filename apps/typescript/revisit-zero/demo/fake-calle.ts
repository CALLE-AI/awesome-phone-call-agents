import type { CalleTransport, CallOutcome, CallRequest } from "../src/calle-client.js";
import type { StructuredCallResult } from "../src/result-schema.js";

export const GOLDEN_RESULT: StructuredCallResult = {
  schemaVersion: "1.0",
  contactOutcome: "REACHED",
  accessResolution: {
    gateUnlocked: "YES",
    dogSecured: "YES",
    obstructionRemoved: "YES",
    presenceArranged: "YES",
    externalAccessPartyResolved: "NOT_APPLICABLE",
  },
  selectedVisitWindowId: "THU_PM",
  optOut: false,
};

export class FakeCalleTransport implements CalleTransport {
  readonly mode = "fake" as const;
  readonly invocations: CallRequest[] = [];
  readonly #results: ReadonlyMap<string, unknown>;
  readonly #ambiguousCases: ReadonlySet<string>;

  constructor(options?: { results?: ReadonlyMap<string, unknown>; ambiguousCases?: ReadonlySet<string> }) {
    this.#results = options?.results ?? new Map([["MTR-2026-0042", GOLDEN_RESULT]]);
    this.#ambiguousCases = options?.ambiguousCases ?? new Set();
  }

  async startOneCall(request: CallRequest): Promise<CallOutcome> {
    this.invocations.push(structuredClone(request));
    const callId = `fake-${request.idempotencyKey.slice(0, 12)}`;
    if (this.#ambiguousCases.has(request.caseId)) {
      return {
        kind: "AMBIGUOUS",
        callId,
        reconciliationReference: request.idempotencyKey,
        reason: "Fake transport simulated a lost provider response; no redial is permitted.",
      };
    }
    if (!this.#results.has(request.caseId)) {
      return { kind: "REJECTED_BEFORE_START", reason: "Fake transport has no scripted result for this case." };
    }
    return { kind: "COMPLETED", callId, rawResult: structuredClone(this.#results.get(request.caseId)) };
  }
}
