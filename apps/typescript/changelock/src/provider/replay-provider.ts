import confirmed from "../fixtures/call-results/confirmed.json";
import denied from "../fixtures/call-results/denied.json";
import unableToVerify from "../fixtures/call-results/unable-to-verify.json";
import unreachable from "../fixtures/call-results/unreachable.json";
import sensitiveData from "../fixtures/call-results/sensitive-data.json";
import malformed from "../fixtures/call-results/malformed.json";
import inProgress from "../fixtures/call-results/in-progress.json";
import type { FixtureName } from "../fixtures/call-results";
import { resolveDispatchInput } from "../application/resolve-dispatch-input";
import { getIntentByProviderCallId, type Db } from "../infrastructure/db";
import type {
  CallProvider,
  CreateCallOutcome,
  ProviderCallSnapshot,
  ReservedCallInput,
} from "./call-provider";

const FIXTURES = {
  confirmed,
  denied,
  "unable-to-verify": unableToVerify,
  unreachable,
  "sensitive-data": sensitiveData,
  malformed,
  "in-progress": inProgress,
} as const;

export type ReplayScenario = FixtureName | "acceptance_unknown" | "rejected";

export function replaySnapshotFor(
  callId: string,
  input: ReservedCallInput,
): ProviderCallSnapshot {
  const m = /^replay_([a-z-]+)_/.exec(callId);
  const scenario = m?.[1] as FixtureName | undefined;
  if (!scenario || !(scenario in FIXTURES)) {
    throw new Error(`unknown replay call id ${callId}`);
  }
  const f = FIXTURES[scenario] as Omit<
    ProviderCallSnapshot,
    "id" | "dialedPhoneE164" | "metadata"
  >;
  return {
    ...f,
    id: callId,
    dialedPhoneE164: input.phoneE164,
    metadata: { ...input.metadata },
  };
}

export function createReplayRefreshProvider(db: Db): CallProvider {
  return {
    create: () => Promise.reject(new Error("refresh-only provider cannot create calls")),
    get: async (callId) => {
      const intent = await getIntentByProviderCallId(db, callId);
      if (!intent) throw new Error(`unknown replay call id ${callId}`);
      return replaySnapshotFor(callId, await resolveDispatchInput(db, intent.id));
    },
  };
}

export class ReplayCallProvider implements CallProvider {
  private readonly calls = new Map<string, { scenario: FixtureName; input: ReservedCallInput }>();

  constructor(private readonly scenario: ReplayScenario) {}

  create(input: ReservedCallInput): Promise<CreateCallOutcome> {
    if (this.scenario === "rejected") {
      return Promise.resolve({ kind: "rejected", code: "invalid_request" });
    }
    if (this.scenario === "acceptance_unknown") {
      return Promise.resolve({ kind: "acceptance_unknown", code: "network_error" });
    }
    const callId = `replay_${this.scenario}_${input.idempotencyKey.slice(3, 15)}`;
    this.calls.set(callId, { scenario: this.scenario, input });
    return Promise.resolve({ kind: "accepted", snapshot: this.buildSnapshot(callId) });
  }

  get(callId: string): Promise<ProviderCallSnapshot> {
    if (!this.calls.has(callId)) {
      return Promise.reject(new Error(`unknown replay call id ${callId}`));
    }
    return Promise.resolve(this.buildSnapshot(callId));
  }

  private buildSnapshot(callId: string): ProviderCallSnapshot {
    const entry = this.calls.get(callId)!;
    const f = FIXTURES[entry.scenario] as Omit<
      ProviderCallSnapshot,
      "id" | "dialedPhoneE164" | "metadata"
    >;
    return {
      ...f,
      id: callId,
      dialedPhoneE164: entry.input.phoneE164,
      metadata: { ...entry.input.metadata },
    };
  }
}
