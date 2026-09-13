import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  waitForResult: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@call-e/calle", () => ({
  CalleClient: class {
    readonly calls = {
      create: sdk.create,
      waitForResult: sdk.waitForResult,
      get: sdk.get,
    };
  },
}));

import { createApprovedBookingContract } from "../src/domain/booking-contract.js";
import { createPreferenceIntakeContract } from "../src/domain/dining-preferences.js";
import {
  createExecutionContext,
  createIntakeExecutionContext,
} from "../src/domain/execution-context.js";
import { CalleIntakeProvider } from "../src/providers/calle/calle-intake-provider.js";
import { CalleSdkProvider } from "../src/providers/calle/calle-sdk-provider.js";

beforeEach(() => {
  sdk.create.mockReset();
  sdk.waitForResult.mockReset();
  sdk.get.mockReset();
});

describe("native CALL-E SDK providers", () => {
  it("sends Agent Jake only the approved booking contract", async () => {
    const call = makeSdkCall({
      structuredResult: {
        outcome: "confirmed",
        confirmedDate: "2026-09-18",
        confirmedTime: "19:30",
        confirmedPartySize: 2,
        confirmationCode: "SDK-42",
        alternativeDate: null,
        alternativeTime: null,
        notes: null,
      },
      transcriptTurns: [
        { speaker: "agent", text: "I am an AI assistant calling for a diner." },
        { speaker: "recipient", text: "The reservation is confirmed." },
      ],
    });
    sdk.create.mockResolvedValue(call);
    sdk.waitForResult.mockResolvedValue(call);

    const contract = createApprovedBookingContract({
      restaurant: {
        name: "Harbor Test Kitchen",
        address: "100 Example Avenue, New York, NY",
        phone: "+12025550143",
      },
      reservation: {
        date: "2026-09-18",
        time: "19:30",
        timeZone: "America/New_York",
        partySize: 2,
        guestName: "Demo Guest",
        specialRequests: "Quiet table if available",
      },
    });
    const provider = new CalleSdkProvider({
      apiKey: "local-test-key",
      allowRealCalls: true,
      allowedPhoneNumbers: new Set([contract.restaurant.phone]),
      timeoutMs: 12_345,
    });

    const result = await provider.execute(
      contract,
      contract.idempotencyKey,
      createExecutionContext(contract.contractId),
    );

    expect(sdk.create).toHaveBeenCalledOnce();
    expect(sdk.waitForResult).toHaveBeenCalledOnce();
    const [request, options] = sdk.create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      recipient: { phone: "+12025550143", region: "US", locale: "en-US" },
      metadata: {
        application: "dineline-calle-edition",
        contractId: contract.contractId,
      },
    });
    expect(request.task).toContain("You are Agent Jake");
    expect(request.task).toContain("clearly disclose that you are an AI assistant");
    expect(request.task).toContain("clear United States English");
    expect(request.task).toContain("controlled demonstration with an authorized participant");
    expect(request.task).toContain("Do not accept a different date, time, or party size");
    expect(options).toEqual({ idempotencyKey: contract.idempotencyKey });
    expect(sdk.waitForResult).toHaveBeenCalledWith("call-test-1", {
      timeoutMs: 12_345,
    });
    expect(result).toMatchObject({
      providerCallId: "call-test-1",
      status: "completed",
      transcript: [
        "agent: I am an AI assistant calling for a diner.",
        "recipient: The reservation is confirmed.",
      ],
    });
  });

  it("keeps the DineLine Concierge task limited to preference intake", async () => {
    const call = makeSdkCall({
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
        notes: null,
      },
      transcriptTurns: [
        { speaker: "agent", text: "I am the DineLine AI assistant." },
        { speaker: "recipient", text: "Italian in Manhattan for two." },
      ],
    });
    sdk.create.mockResolvedValue(call);
    sdk.waitForResult.mockResolvedValue(call);

    const contract = createPreferenceIntakeContract({
      phone: "+12025550109",
      sessionId: "session-sdk-intake",
      explicitConsent: true,
    });
    const provider = new CalleIntakeProvider({
      apiKey: "local-test-key",
      allowRealCalls: true,
      allowedPhoneNumbers: new Set([contract.phone]),
      timeoutMs: 54_321,
    });

    const result = await provider.execute(
      contract,
      contract.idempotencyKey,
      createIntakeExecutionContext(contract.requestId),
    );

    expect(sdk.create).toHaveBeenCalledOnce();
    expect(sdk.waitForResult).toHaveBeenCalledOnce();
    const [request, options] = sdk.create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      recipient: { phone: "+12025550109", region: "US", locale: "en-US" },
      metadata: {
        application: "dineline-calle-edition",
        agentRole: "dining-preference-intake",
        requestId: contract.requestId,
      },
    });
    expect(request.task).toContain("You are the DineLine Concierge");
    expect(request.task).toContain("clear United States English");
    expect(request.task).toContain("Do not search for restaurants");
    expect(request.task).toContain("make a reservation");
    expect(request.task).toContain("Use none for optional notes");
    expect(options).toEqual({ idempotencyKey: contract.idempotencyKey });
    expect(sdk.waitForResult).toHaveBeenCalledWith("call-test-1", {
      timeoutMs: 54_321,
    });
    expect(result.transcript).toEqual([
      "agent: I am the DineLine AI assistant.",
      "recipient: Italian in Manhattan for two.",
    ]);
  });

  it("blocks a direct provider instance when its real-call policy is closed", async () => {
    const contract = createPreferenceIntakeContract({
      phone: "+12025550109",
      sessionId: "session-sdk-blocked",
      explicitConsent: true,
    });
    const provider = new CalleIntakeProvider({
      apiKey: "local-test-key",
      allowRealCalls: false,
      allowedPhoneNumbers: new Set([contract.phone]),
    });

    await expect(
      provider.execute(
        contract,
        contract.idempotencyKey,
        createIntakeExecutionContext(contract.requestId),
      ),
    ).rejects.toThrow("disabled by policy");
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("preserves the accepted call ID when terminal waiting fails", async () => {
    const contract = createPreferenceIntakeContract({
      phone: "+12025550109",
      sessionId: "session-sdk-pending",
      explicitConsent: true,
    });
    sdk.create.mockResolvedValue(makeSdkCall({
      structuredResult: null,
      transcriptTurns: [],
    }));
    sdk.waitForResult.mockRejectedValue(new Error("Timed out waiting for CALL-E"));
    const provider = new CalleIntakeProvider({
      apiKey: "local-test-key",
      allowRealCalls: true,
      allowedPhoneNumbers: new Set([contract.phone]),
      timeoutMs: 50,
    });

    await expect(
      provider.execute(
        contract,
        contract.idempotencyKey,
        createIntakeExecutionContext(contract.requestId),
      ),
    ).rejects.toMatchObject({
      name: "AcceptedCallStatusUnknownError",
      providerCallId: "call-test-1",
    });
    expect(sdk.create).toHaveBeenCalledOnce();
    expect(sdk.waitForResult).toHaveBeenCalledOnce();
  });

  it("reads one exact accepted call without creating another call", async () => {
    const call = makeSdkCall({
      structuredResult: {
        outcome: "unavailable",
        confirmedDate: "unknown",
        confirmedTime: "unknown",
        confirmedPartySize: 0,
        confirmationCode: "none",
        alternativeDate: "unknown",
        alternativeTime: "unknown",
        notes: "Requested time was unavailable.",
      },
      transcriptTurns: [],
    });
    sdk.get.mockResolvedValue(call);
    const provider = new CalleSdkProvider({
      apiKey: "local-test-key",
      allowRealCalls: true,
      allowedPhoneNumbers: new Set(["+12025550143"]),
    });

    const result = await provider.getResult("call-test-1");

    expect(sdk.get).toHaveBeenCalledWith("call-test-1");
    expect(sdk.create).not.toHaveBeenCalled();
    expect(result.providerCallId).toBe("call-test-1");
  });
});

function makeSdkCall(input: {
  structuredResult: unknown;
  transcriptTurns: Array<{ speaker: string; text: string }>;
}) {
  return {
    id: "call-test-1",
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.98, label: "high" },
    structuredResult: input.structuredResult,
    evidence: ["The requested facts were confirmed during the call."],
    summary: "The call completed.",
    recipients: [
      {
        attempts: [
          {
            transcriptTurns: input.transcriptTurns,
          },
        ],
      },
    ],
    failureCode: null,
    failureMessage: null,
    metadata: {},
    createdAt: "2026-09-12T07:43:05.000Z",
    completedAt: "2026-09-12T07:46:26.000Z",
  };
}
