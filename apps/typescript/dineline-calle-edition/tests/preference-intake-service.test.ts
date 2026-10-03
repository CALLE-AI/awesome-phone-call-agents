import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPreferenceIntakeContract,
  type ApprovedPreferenceIntakeContract,
} from "../src/domain/dining-preferences.js";
import type { IntakeExecutionContext } from "../src/domain/execution-context.js";
import { FixturePreferenceIntakeProvider } from "../src/providers/calle/fixture-intake-provider.js";
import type { PreferenceIntakeProvider } from "../src/providers/calle/intake-types.js";
import {
  AcceptedCallStatusUnknownError,
  type ProviderCallResult,
} from "../src/providers/calle/types.js";
import { FileIdempotencyStore } from "../src/services/idempotency-store.js";
import { PreferenceIntakeService } from "../src/services/preference-intake-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("DineLine CALL-E preference intake", () => {
  it("accepts a complete evidence-backed preference result", async () => {
    const result = await run(new FixturePreferenceIntakeProvider("complete"));

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.usableForSearch).toBe(true);
      expect(result.outcome.needsUserInput).toBe(false);
      expect(result.outcome.preferences).toMatchObject({
        location: "Manhattan, New York",
        cuisine: "Italian",
        partySize: 2,
      });
    }
  });

  it("returns missing fields for an incomplete but valid conversation", async () => {
    const result = await run(new FixturePreferenceIntakeProvider("missing"));

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.usableForSearch).toBe(false);
      expect(result.outcome.needsUserInput).toBe(true);
      expect(result.outcome.missingFields).toEqual(["location"]);
    }
  });

  it("does not trust structured preferences without evidence", async () => {
    const result = await run(new NoEvidenceProvider());

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.usableForSearch).toBe(false);
      expect(result.outcome.needsUserInput).toBe(true);
    }
  });

  it("redacts phone-bearing preference summary and evidence copies", async () => {
    const result = await run(new PhoneBearingIntakeProvider());

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.outcome.usableForSearch).toBe(true);
      expect(result.outcome.summary).toBe(
        "Dinner preferences confirmed at [phone redacted].",
      );
      expect(result.outcome.evidence).toEqual([
        "The diner confirmed every field by calling [phone redacted].",
      ]);
    }
  });

  it("fails closed and never retries an ambiguous preference dispatch", async () => {
    const contract = makeContract();
    const provider = new ThrowingIntakeProvider();
    const service = new PreferenceIntakeService(provider, await makeStore());

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

  it("redacts phone numbers copied from preference-provider errors", async () => {
    const result = await run(
      new ThrowingIntakeProvider("Provider 202-555-0199 timed out"),
    );

    expect(result.kind).toBe("dispatch_unknown");
    if (result.kind === "dispatch_unknown") {
      expect(result.outcome.summary).toContain("[phone redacted]");
      expect(result.outcome.summary).not.toContain("202");
    }
  });

  it("stores an accepted call ID and reconciles it without another dispatch", async () => {
    const contract = makeContract();
    const provider = new AcceptedThenCompletedIntakeProvider();
    const store = await makeStore();
    const service = new PreferenceIntakeService(provider, store);

    const first = await service.execute(contract);
    const stored = await store.read(contract.idempotencyKey);
    const reconciled = await service.reconcile(contract);

    expect(first).toMatchObject({
      kind: "dispatch_unknown",
      outcome: { providerCallId: "call-accepted-intake" },
    });
    expect(stored).toMatchObject({
      state: "dispatch_unknown",
      providerCallId: "call-accepted-intake",
    });
    expect(reconciled).toMatchObject({
      kind: "completed",
      outcome: { usableForSearch: true },
    });
    expect(provider.executeCount).toBe(1);
    expect(provider.readCount).toBe(1);
  });

  it("creates a stable frozen request without storing the phone in the ID", () => {
    const left = makeContract("2026-09-10T09:00:00.000Z");
    const right = makeContract("2026-09-10T10:00:00.000Z");

    expect(left.requestId).toBe(right.requestId);
    expect(left.idempotencyKey).toBe(right.idempotencyKey);
    expect(left.requestId).not.toContain("2025550109");
    expect(Object.isFrozen(left)).toBe(true);
  });
});

async function run(provider: PreferenceIntakeProvider) {
  return new PreferenceIntakeService(provider, await makeStore()).execute(
    makeContract(),
  );
}

async function makeStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "dineline-intake-"));
  temporaryDirectories.push(directory);
  return new FileIdempotencyStore(directory);
}

function makeContract(requestedAt?: string): ApprovedPreferenceIntakeContract {
  return createPreferenceIntakeContract(
    {
      phone: "+12025550109",
      sessionId: "session-intake-test",
      explicitConsent: true,
    },
    requestedAt,
  );
}

class ThrowingIntakeProvider implements PreferenceIntakeProvider {
  readonly name = "timeout-intake-fixture";
  callCount = 0;

  constructor(readonly message = "Provider timed out") {}

  async execute(
    _contract: ApprovedPreferenceIntakeContract,
    _idempotencyKey: string,
    _context: IntakeExecutionContext,
  ): Promise<ProviderCallResult> {
    this.callCount += 1;
    throw new Error(this.message);
  }
}

class PhoneBearingIntakeProvider implements PreferenceIntakeProvider {
  readonly name = "phone-bearing-intake-fixture";

  async execute(): Promise<ProviderCallResult> {
    return {
      providerCallId: "fixture-phone-bearing-intake",
      status: "completed",
      taskCompleted: true,
      completionConfidence: { score: 0.98, label: "high" },
      structuredResult: {
        location: "Manhattan, New York",
        cuisine: "Italian",
        date: "2026-09-18",
        time: "19:30",
        timeZone: "America/New_York",
        partySize: 2,
        budget: "upscale",
        atmosphere: "quiet",
        dietaryNeeds: [],
        notes: null,
      },
      evidence: [
        "The diner confirmed every field by calling +1 (202) 555-0199.",
      ],
      summary: "Dinner preferences confirmed at 202-555-0198.",
      transcript: [],
      failureCode: null,
      failureMessage: null,
    };
  }
}

class NoEvidenceProvider implements PreferenceIntakeProvider {
  readonly name = "no-evidence-fixture";

  async execute(): Promise<ProviderCallResult> {
    return {
      providerCallId: "fixture-no-evidence",
      status: "completed",
      taskCompleted: true,
      completionConfidence: { score: 0.98, label: "high" },
      structuredResult: {
        location: "Manhattan, New York",
        cuisine: "Italian",
        date: "2026-09-18",
        time: "19:30",
        timeZone: "America/New_York",
        partySize: 2,
        budget: "upscale",
        atmosphere: "quiet",
        dietaryNeeds: [],
        notes: null,
      },
      evidence: [],
      summary: "Unverified preferences.",
      transcript: [],
      failureCode: null,
      failureMessage: null,
    };
  }
}

class AcceptedThenCompletedIntakeProvider implements PreferenceIntakeProvider {
  readonly name = "accepted-then-completed-intake";
  executeCount = 0;
  readCount = 0;

  async execute(): Promise<ProviderCallResult> {
    this.executeCount += 1;
    throw new AcceptedCallStatusUnknownError(
      "call-accepted-intake",
      new Error("wait timed out"),
    );
  }

  async getResult(providerCallId: string): Promise<ProviderCallResult> {
    this.readCount += 1;
    return {
      providerCallId,
      status: "completed",
      taskCompleted: true,
      completionConfidence: { score: 0.95, label: "high" },
      structuredResult: {
        location: "Manhattan, New York",
        cuisine: "Italian",
        date: "2026-09-18",
        time: "19:30",
        timeZone: "America/New_York",
        partySize: 2,
        budget: "upscale",
        atmosphere: "quiet enough to talk",
        dietaryNeeds: [],
        notes: "none",
      },
      evidence: ["The diner confirmed every required preference."],
      summary: "Dinner preferences captured.",
      transcript: [],
      failureCode: null,
      failureMessage: null,
    };
  }
}
