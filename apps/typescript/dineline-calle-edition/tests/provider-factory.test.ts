import { describe, expect, it } from "vitest";

import {
  createApprovedBookingContract,
} from "../src/domain/booking-contract.js";
import {
  createPreferenceIntakeContract,
} from "../src/domain/dining-preferences.js";
import {
  createExecutionContext,
  createIntakeExecutionContext,
} from "../src/domain/execution-context.js";
import { createPreferenceIntakeProvider } from "../src/providers/calle/intake-provider-factory.js";
import { createBookingCallProvider } from "../src/providers/calle/provider-factory.js";

describe("CALL-E provider safety gates", () => {
  it("defaults to the fixture provider", () => {
    expect(createBookingCallProvider({}).name).toBe("fixture");
  });

  it("blocks real mode without the explicit call switch", () => {
    expect(() =>
      createBookingCallProvider({
        DINELINE_CALL_MODE: "real",
        CALLE_API_KEY: "local-test-key",
      }),
    ).toThrow("DINELINE_ALLOW_REAL_CALLS=true");
  });

  it("blocks real mode without a CALL-E API key", () => {
    expect(() =>
      createBookingCallProvider({
        DINELINE_CALL_MODE: "real",
        DINELINE_ALLOW_REAL_CALLS: "true",
        DINELINE_ALLOWED_BOOKING_PHONES: "+12025550143",
      }),
    ).toThrow("CALLE_API_KEY is required");
  });

  it("blocks real booking mode without an explicit destination allowlist", () => {
    expect(() =>
      createBookingCallProvider({
        DINELINE_CALL_MODE: "real",
        DINELINE_ALLOW_REAL_CALLS: "true",
        CALLE_API_KEY: "local-test-key",
      }),
    ).toThrow("DINELINE_ALLOWED_BOOKING_PHONES");
  });

  it("rejects a browser-supplied booking destination outside the allowlist", async () => {
    const provider = createBookingCallProvider({
      DINELINE_CALL_MODE: "real",
      DINELINE_ALLOW_REAL_CALLS: "true",
      DINELINE_ALLOWED_BOOKING_PHONES: "+12025550144",
      CALLE_API_KEY: "local-test-key",
    });
    const contract = createApprovedBookingContract({
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
    });

    await expect(
      provider.execute(
        contract,
        contract.idempotencyKey,
        createExecutionContext(contract.contractId),
      ),
    ).rejects.toThrow("Agent Jake destination is not explicitly allowlisted");
  });

  it("keeps the preference agent on fixtures by default", () => {
    expect(createPreferenceIntakeProvider({}).name).toBe("fixture-intake");
  });

  it("does not let the booking-agent gate arm the preference agent", () => {
    expect(() =>
      createPreferenceIntakeProvider({
        DINELINE_CALL_MODE: "real",
        DINELINE_ALLOW_REAL_CALLS: "true",
        CALLE_API_KEY: "local-test-key",
      }),
    ).toThrow("DINELINE_ALLOW_REAL_INTAKE_CALLS=true");
  });

  it("blocks real preference mode without a CALL-E API key", () => {
    expect(() =>
      createPreferenceIntakeProvider({
        DINELINE_CALL_MODE: "real",
        DINELINE_ALLOW_REAL_INTAKE_CALLS: "true",
        DINELINE_ALLOWED_INTAKE_PHONES: "+12025550109",
      }),
    ).toThrow("CALLE_API_KEY is required");
  });

  it("blocks real intake mode without an explicit destination allowlist", () => {
    expect(() =>
      createPreferenceIntakeProvider({
        DINELINE_CALL_MODE: "real",
        DINELINE_ALLOW_REAL_INTAKE_CALLS: "true",
        CALLE_API_KEY: "local-test-key",
      }),
    ).toThrow("DINELINE_ALLOWED_INTAKE_PHONES");
  });

  it("rejects a diner phone outside the intake allowlist", async () => {
    const provider = createPreferenceIntakeProvider({
      DINELINE_CALL_MODE: "real",
      DINELINE_ALLOW_REAL_INTAKE_CALLS: "true",
      DINELINE_ALLOWED_INTAKE_PHONES: "+12025550110",
      CALLE_API_KEY: "local-test-key",
    });
    const contract = createPreferenceIntakeContract({
      phone: "+12025550109",
      sessionId: "session-intake-allowlist",
      explicitConsent: true,
    });

    await expect(
      provider.execute(
        contract,
        contract.idempotencyKey,
        createIntakeExecutionContext(contract.requestId),
      ),
    ).rejects.toThrow(
      "DineLine Concierge destination is not explicitly allowlisted",
    );
  });
});
