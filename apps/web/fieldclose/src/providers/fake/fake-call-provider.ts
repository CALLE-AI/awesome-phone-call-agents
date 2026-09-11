import {
  fakeScenarioIdValues,
  getFakeScenarioSnapshot,
  type FakeScenarioId,
} from "@/providers/fake/scenarios";
import type {
  CallProvider,
  CreateCallRequest,
  ProviderCallSnapshot,
  ProviderCreationOutcome,
} from "@/providers/types";

const fakeCallPrefix = "fake:";

export class FakeCallProvider implements CallProvider {
  readonly providerName = "fake" as const;

  constructor(private readonly scenarioId: FakeScenarioId) {}

  async createCall(
    request: CreateCallRequest,
  ): Promise<ProviderCreationOutcome> {
    if (this.scenarioId === "creation_timeout_unknown") {
      return {
        disposition: "ambiguous_requires_reconciliation",
        errorCode: "fake_creation_timeout",
      };
    }

    return {
      disposition: "created",
      providerCallId: createFakeCallId(this.scenarioId, request.attemptId),
      taskStatus: "queued",
    };
  }

  async getCall(providerCallId: string): Promise<ProviderCallSnapshot> {
    const { scenarioId } = parseFakeCallId(providerCallId);
    const snapshot = getFakeScenarioSnapshot(scenarioId);

    return {
      providerCallId,
      ...snapshot,
    };
  }
}

function createFakeCallId(scenarioId: FakeScenarioId, attemptId: string) {
  return `${fakeCallPrefix}${scenarioId}:${attemptId}`;
}

function parseFakeCallId(providerCallId: string) {
  if (!providerCallId.startsWith(fakeCallPrefix)) {
    throw new Error("Fake provider received an unsupported call identifier");
  }

  const separatorIndex = providerCallId.indexOf(":", fakeCallPrefix.length);
  const scenarioId = providerCallId.slice(
    fakeCallPrefix.length,
    separatorIndex,
  );
  const attemptId = providerCallId.slice(separatorIndex + 1);

  if (
    separatorIndex === -1 ||
    !fakeScenarioIdValues.includes(scenarioId as FakeScenarioId) ||
    attemptId.length === 0
  ) {
    throw new Error("Fake provider call identifier is malformed");
  }

  return { scenarioId: scenarioId as FakeScenarioId, attemptId };
}
