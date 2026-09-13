import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createApprovedBookingContract,
  type ApprovedBookingContract,
} from "../src/domain/booking-contract.js";
import { FixtureBookingProvider } from "../src/providers/calle/fixture-provider.js";
import type {
  BookingCallProvider,
  ProviderCallResult,
} from "../src/providers/calle/types.js";
import { AcceptedCallStatusUnknownError } from "../src/providers/calle/types.js";
import { BookingCallService } from "../src/services/booking-call-service.js";
import { FileIdempotencyStore } from "../src/services/idempotency-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("DineLine CALL-E booking closure loop", () => {
  it.each([
    ["confirmed", "confirmed"],
    ["unavailable", "unavailable"],
    ["alternative", "alternative_offered"],
    ["voicemail", "unreached"],
  ] as const)("verifies the %s fixture", async (scenario, expectedOutcome) => {
    const result = await run(new FixtureBookingProvider(scenario));
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.outcome).toBe(expectedOutcome);
    }
  });

  it("fails closed when structured confirmation contradicts the evidence", async () => {
    const result = await run(new FixtureBookingProvider("contradiction"));
    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.outcome).toBe("uncertain");
      expect(result.outcome.needsHumanReview).toBe(true);
    }
  });

  it("does not treat a provider summary as confirmation evidence", async () => {
    const contract = makeContract();
    const result = await run(
      new ScriptedProvider({
        ...confirmedResult(contract),
        evidence: [],
        transcript: [],
        summary: "Reservation confirmed.",
      }),
    );

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.outcome).toBe("uncertain");
      expect(result.outcome.needsHumanReview).toBe(true);
    }
  });

  it("rejects a structured confirmation when the transcript says no confirmation", async () => {
    const contract = makeContract();
    const result = await run(
      new ScriptedProvider({
        ...confirmedResult(contract),
        evidence: ["The restaurant said there is no confirmation."],
        transcript: ["restaurant: There is no confirmation for that request."],
      }),
    );

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.outcome).toBe("uncertain");
    }
  });

  it("fails closed when the provider times out", async () => {
    const result = await run(new ThrowingProvider());
    expect(result.kind).toBe("dispatch_unknown");
    if (result.kind === "dispatch_unknown") {
      expect(result.state).toBe("dispatch_unknown");
      expect(result.outcome.outcome).toBe("uncertain");
      expect(result.outcome.summary).toContain("timed out");
    }
  });

  it("does not retry a booking after the first dispatch becomes unknown", async () => {
    const contract = makeContract();
    const provider = new ThrowingProvider();
    const store = await makeStore();
    const service = new BookingCallService(provider, store);

    const first = await service.execute(contract);
    const second = await service.execute(contract);

    expect(first.kind).toBe("dispatch_unknown");
    expect(second).toMatchObject({
      kind: "duplicate_blocked",
      state: "dispatch_unknown",
      idempotencyKey: contract.idempotencyKey,
    });
    expect(provider.callCount).toBe(1);
  });

  it("stores an accepted call ID and reconciles it without another dispatch", async () => {
    const contract = makeContract();
    const provider = new AcceptedThenCompletedProvider(contract);
    const store = await makeStore();
    const service = new BookingCallService(provider, store);

    const first = await service.execute(contract);
    const stored = await store.read(contract.idempotencyKey);
    const reconciled = await service.reconcile(contract);

    expect(first).toMatchObject({
      kind: "dispatch_unknown",
      outcome: { providerCallId: "call-accepted-booking" },
    });
    expect(stored).toMatchObject({
      state: "dispatch_unknown",
      providerCallId: "call-accepted-booking",
    });
    expect(reconciled).toMatchObject({
      kind: "completed",
      outcome: { outcome: "confirmed" },
    });
    expect(provider.executeCount).toBe(1);
    expect(provider.readCount).toBe(1);
  });

  it("reserves the fingerprint before execution and blocks a duplicate", async () => {
    const contract = makeContract();
    const provider = new FixtureBookingProvider("confirmed");
    const store = await makeStore();
    const service = new BookingCallService(provider, store);

    const first = await service.execute(contract);
    const second = await service.execute(contract);

    expect(first.kind).toBe("completed");
    expect(second.kind).toBe("duplicate_blocked");
    expect(provider.callCount).toBe(1);
  });

  it("creates a stable frozen contract from the same approved details", () => {
    const left = makeContract("2026-09-09T09:00:00.000Z");
    const right = makeContract("2026-09-09T10:00:00.000Z");

    expect(left.contractId).toBe(right.contractId);
    expect(left.idempotencyKey).toBe(right.idempotencyKey);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.reservation)).toBe(true);
  });
});

async function run(provider: BookingCallProvider) {
  const service = new BookingCallService(provider, await makeStore());
  return service.execute(makeContract());
}

async function makeStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "dineline-calle-"));
  temporaryDirectories.push(directory);
  return new FileIdempotencyStore(directory);
}

function makeContract(approvedAt?: string): ApprovedBookingContract {
  return createApprovedBookingContract(
    {
      restaurant: {
        name: "Harbor Test Kitchen",
        address: "100 Example Avenue, New York, NY",
        phone: "+12025550143",
      },
      reservation: {
        date: "2026-09-12",
        time: "19:30",
        timeZone: "America/New_York",
        partySize: 2,
        guestName: "Demo Guest",
        specialRequests: "",
      },
    },
    approvedAt,
  );
}

class ThrowingProvider implements BookingCallProvider {
  readonly name = "timeout-fixture";
  callCount = 0;

  async execute(
    _contract: ApprovedBookingContract,
    _idempotencyKey: string,
  ): Promise<ProviderCallResult> {
    this.callCount += 1;
    throw new Error("Provider timed out");
  }
}

class ScriptedProvider implements BookingCallProvider {
  readonly name = "scripted-fixture";

  constructor(readonly result: ProviderCallResult) {}

  async execute(): Promise<ProviderCallResult> {
    return this.result;
  }
}

class AcceptedThenCompletedProvider implements BookingCallProvider {
  readonly name = "accepted-then-completed";
  executeCount = 0;
  readCount = 0;

  constructor(readonly contract: ApprovedBookingContract) {}

  async execute(): Promise<ProviderCallResult> {
    this.executeCount += 1;
    throw new AcceptedCallStatusUnknownError(
      "call-accepted-booking",
      new Error("wait timed out"),
    );
  }

  async getResult(providerCallId: string): Promise<ProviderCallResult> {
    this.readCount += 1;
    return {
      ...confirmedResult(this.contract),
      providerCallId,
    };
  }
}

function confirmedResult(
  contract: ApprovedBookingContract,
): ProviderCallResult {
  return {
    providerCallId: "scripted-call-1",
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.98, label: "high" },
    structuredResult: {
      outcome: "confirmed",
      confirmedDate: contract.reservation.date,
      confirmedTime: contract.reservation.time,
      confirmedPartySize: contract.reservation.partySize,
      confirmationCode: "SCRIPTED-1",
      alternativeDate: null,
      alternativeTime: null,
      notes: "Structured output claims confirmation.",
    },
    evidence: ["The reservation is confirmed."],
    summary: "Reservation confirmed.",
    transcript: ["restaurant: The reservation is confirmed."],
    failureCode: null,
    failureMessage: null,
  };
}
