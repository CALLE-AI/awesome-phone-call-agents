import { describe, expect, it } from "vitest";

import {
  PollingPhoneApiAdapter,
  ScriptedPhoneApiAdapter,
} from "../server/calle/phone-api-adapters";
import {
  createFailoverCalleAdapter,
  isFailoverEligible,
  wasCallAccepted,
} from "../server/calle/provider-failover";
import type { PlaceCallCommand, ProviderCallResult } from "../server/calle/adapter";

const command: PlaceCallCommand = {
  workflowId: "wf_failover_health",
  idempotencyKey: "idem-failover-health",
  recipientE164: "+15555550123",
  recipientRegion: "US",
  purpose: "follow_up_after_check_in",
  callLanguage: "en",
  dryRun: true,
};

function unavailable(providerId: string, cmd: PlaceCallCommand): ProviderCallResult {
  return {
    providerCallId: `failed_${cmd.workflowId}`,
    status: "failed",
    structuredResult: null,
    failureCode: "provider_unavailable",
    phoneProviderId: providerId,
  };
}

describe("CALL-E provider failover circuit breaker", () => {
  it("classifies outages as failover-eligible and accepted runs as sticky", () => {
    expect(
      isFailoverEligible({
        providerCallId: "failed_wf",
        status: "failed",
        structuredResult: null,
        failureCode: "provider_unavailable",
      }),
    ).toBe(true);
    expect(
      wasCallAccepted({
        providerCallId: "call-e_run_1",
        status: "no_answer",
        structuredResult: null,
        failureCode: "no_answer",
      }),
    ).toBe(true);
    expect(
      isFailoverEligible({
        providerCallId: "call-e_run_1",
        status: "no_answer",
        structuredResult: null,
        failureCode: "no_answer",
      }),
    ).toBe(false);
  });

  it("skips an open primary circuit and dials the healthy backup", async () => {
    let now = 1_000;
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: (cmd) => unavailable("call-e", cmd),
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 1,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
      policy: { openAfterConsecutiveFailures: 2, cooldownMs: 10_000, now: () => now },
    });

    const first = await adapter.placeFollowUpCall({ ...command, idempotencyKey: "k1", workflowId: "wf1" });
    expect(first.phoneProviderId).toBe("backup-phone-api");
    expect(primary.placeCalls).toBe(1);
    expect(backup.placeCalls).toBe(1);

    const second = await adapter.placeFollowUpCall({ ...command, idempotencyKey: "k2", workflowId: "wf2" });
    expect(second.phoneProviderId).toBe("backup-phone-api");
    expect(primary.placeCalls).toBe(2);
    expect(backup.placeCalls).toBe(2);

    const health = adapter.getHealthSnapshot();
    expect(health.find((row) => row.id === "call-e")?.circuit).toBe("open");
    expect(health.find((row) => row.id === "backup-phone-api")?.circuit).toBe("closed");

    const third = await adapter.placeFollowUpCall({ ...command, idempotencyKey: "k3", workflowId: "wf3" });
    expect(third.phoneProviderId).toBe("backup-phone-api");
    expect(primary.placeCalls).toBe(2);
    expect(backup.placeCalls).toBe(3);
    expect(adapter.providersForPlace().map((slot) => slot.id)).toEqual(["backup-phone-api"]);
  });

  it("probes a half-open primary after cooldown", async () => {
    let now = 1_000;
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: (cmd) => unavailable("call-e", cmd),
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 1,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
      policy: { openAfterConsecutiveFailures: 1, cooldownMs: 5_000, now: () => now },
    });

    await adapter.placeFollowUpCall({ ...command, idempotencyKey: "c1", workflowId: "c1" });
    expect(adapter.circuitState("call-e")).toBe("open");
    expect(primary.placeCalls).toBe(1);

    await adapter.placeFollowUpCall({ ...command, idempotencyKey: "c2", workflowId: "c2" });
    expect(primary.placeCalls).toBe(1);

    now = 7_000;
    expect(adapter.circuitState("call-e")).toBe("half_open");
    await adapter.placeFollowUpCall({ ...command, idempotencyKey: "c3", workflowId: "c3" });
    expect(primary.placeCalls).toBe(2);
    expect(adapter.circuitState("call-e")).toBe("open");
  });

  it("closes the circuit after a successful probe", async () => {
    let now = 1_000;
    let primaryDown = true;
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: (cmd) => {
        if (primaryDown) return unavailable("call-e", cmd);
        return {
          providerCallId: `call-e_run_${cmd.workflowId}`,
          status: "in_progress",
          structuredResult: null,
          failureCode: null,
          phoneProviderId: "call-e",
        };
      },
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 1,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
      policy: { openAfterConsecutiveFailures: 1, cooldownMs: 1_000, now: () => now },
    });

    await adapter.placeFollowUpCall({ ...command, idempotencyKey: "p1", workflowId: "p1" });
    now = 3_000;
    primaryDown = false;
    const recovered = await adapter.placeFollowUpCall({
      ...command,
      idempotencyKey: "p2",
      workflowId: "p2",
    });
    expect(recovered.phoneProviderId).toBe("call-e");
    expect(adapter.circuitState("call-e")).toBe("closed");
    expect(backup.placeCalls).toBe(1);
  });
});
