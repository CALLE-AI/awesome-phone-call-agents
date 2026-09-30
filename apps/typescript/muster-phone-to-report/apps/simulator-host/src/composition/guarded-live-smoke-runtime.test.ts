import { describe, expect, it, vi } from "vitest";

import { OrganizationId } from "@muster/domain";
import {
  createLiveSmokeRunGate,
  createTwilioLiveSmokeControl,
} from "@muster/infrastructure-twilio-simulator";

import { createGuardedLiveSmokeProcess } from "../cli/guarded-live-smoke-process.js";
import {
  createGuardedRuntimeCleanupOwner,
  createGuardedRuntimeSecretOwner,
  createRecordingSafeReviewTransition,
} from "./guarded-live-smoke-runtime.js";

type CleanupState =
  | "barrier_pending"
  | "awaiting_identity"
  | "awaiting_arrival"
  | "awaiting_terminal"
  | "awaiting_grace"
  | "restoration_ready"
  | "restoration_started"
  | "restored"
  | "secrets_revoked"
  | "host_stopped"
  | "tunnel_stopped"
  | "complete"
  | "blocked";

function createDurableAuthorizationFake(input: {
  readonly operationId: string;
  readonly dispatchClaimedAt?: string | null;
  readonly providerDispatchIdentity?: string | null;
  readonly cleanupState?: CleanupState | null;
  readonly cleanupDeadlineAt?: string | null;
  readonly cleanupGraceUntilAt?: string | null;
  readonly cleanupTerminalStatus?: string | null;
  readonly cleanupStateChangedAt?: string | null;
  readonly dispatchClosedAt?: string | null;
  readonly ownerDigest?: string | null;
}) {
  const row: Record<string, unknown> = {
    operationId: input.operationId,
    dispatchClaimedAt: input.dispatchClaimedAt ?? null,
    providerDispatchIdentity: input.providerDispatchIdentity ?? null,
    dispatchClosedAt: input.dispatchClosedAt ?? null,
    cleanupState: input.cleanupState ?? null,
    cleanupDeadlineAt: input.cleanupDeadlineAt ?? null,
    cleanupGraceUntilAt: input.cleanupGraceUntilAt ?? null,
    cleanupTerminalStatus: input.cleanupTerminalStatus ?? null,
    cleanupStateChangedAt: input.cleanupStateChangedAt ?? null,
    cleanupBlockedReason: null,
  };
  let ownerDigest = input.ownerDigest ?? null;
  const history: string[] = [];
  const authorization = () => Object.freeze({ ...row });
  const repository = {
    closeDispatchAndBeginCleanup: vi.fn(async (request: Record<string, unknown>) => {
      if (row["cleanupState"] === null) {
        row["dispatchClosedAt"] = request["startedAt"];
        row["cleanupState"] = "barrier_pending";
        row["cleanupDeadlineAt"] = request["deadlineAt"];
        row["cleanupStateChangedAt"] = request["startedAt"];
        ownerDigest = request["ownerDigest"] as string;
        history.push("barrier_pending");
        return { outcome: "acquired" as const, authorization: authorization() };
      }
      if (row["cleanupState"] === "blocked" || row["cleanupState"] === "complete") {
        return { outcome: "terminal" as const, authorization: authorization() };
      }
      if (ownerDigest === request["ownerDigest"]) {
        return { outcome: "replayed" as const, authorization: authorization() };
      }
      return { outcome: "in_progress" as const, authorization: authorization() };
    }),
    findByOperationId: vi.fn(async () => authorization()),
    transitionCleanup: vi.fn(async (request: Record<string, unknown>) => {
      if (ownerDigest !== request["ownerDigest"] || row["cleanupState"] !== request["from"]) {
        return { outcome: "conflict" as const };
      }
      row["cleanupState"] = request["to"];
      row["cleanupStateChangedAt"] = request["changedAt"];
      if (request["graceUntilAt"] !== undefined) {
        row["cleanupGraceUntilAt"] = request["graceUntilAt"];
        row["cleanupTerminalStatus"] = request["terminalStatus"];
      }
      if (request["blockedReason"] !== undefined) {
        row["cleanupBlockedReason"] = request["blockedReason"];
      }
      history.push(String(request["to"]));
      return { outcome: "advanced" as const, authorization: authorization() };
    }),
    takeOverCleanup: vi.fn(async (request: Record<string, unknown>) => {
      if (request["previousOwnerStopped"] !== true) return { outcome: "conflict" as const };
      if (row["cleanupState"] === "blocked" || row["cleanupState"] === "complete") {
        return { outcome: "terminal" as const, authorization: authorization() };
      }
      ownerDigest = request["ownerDigest"] as string;
      row["cleanupStateChangedAt"] = request["changedAt"];
      return { outcome: "acquired" as const, authorization: authorization() };
    }),
  };
  return { row, history, repository };
}

describe("guarded live-smoke production secret ownership", () => {
  it("classifies evidence-unavailable terminal projection as failed and requires a failing CLI exit", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    expect(api["classifyGuardedLiveSmokeTerminalOutcome"]).toBeTypeOf("function");
    expect(api["guardedLiveSmokeResultRequiresFailureExit"]).toBeTypeOf("function");
    expect(api["classifyGuardedLiveSmokeTerminalOutcome"]!("observation_recorded")).toBe(
      "completed",
    );
    expect(api["classifyGuardedLiveSmokeTerminalOutcome"]!("evidence_unavailable")).toBe("failed");
    expect(api["guardedLiveSmokeResultRequiresFailureExit"]!({ status: "failed" })).toBe(true);
    expect(api["guardedLiveSmokeResultRequiresFailureExit"]!({ status: "completed" })).toBe(false);
  });

  it.each([false, true])(
    "AC-INTEGRATION-1 composes durable cleanup with keepWebhook=%s",
    async (keepWebhook) => {
      const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
        Record<string, CallableFunction>
      >;
      expect(api["createDurableGuardedRuntimeCleanupCoordinator"]).toBeTypeOf("function");
      const baseTime = Date.parse("2026-08-28T04:00:00.000Z");
      let elapsedMs = 0;
      const liveConfiguration = {
        voiceUrl: "https://live.invalid/twilio/voice",
        statusCallbackUrl: "https://live.invalid/twilio/status",
      };
      let configuration = keepWebhook
        ? { ...liveConfiguration }
        : {
            voiceUrl: "https://reject.invalid/voice",
            statusCallbackUrl: null as string | null,
          };
      const events: string[] = [];
      const durable = createDurableAuthorizationFake({ operationId: "operation-composed-durable" });
      const transport = {
        readConfiguration: vi.fn(async () => ({ ...configuration })),
        updateConfiguration: vi.fn(async (next: typeof configuration) => {
          configuration = { ...next };
          events.push(
            next.statusCallbackUrl === null ? "configuration-restored" : "configuration-armed",
          );
        }),
        listInboundCalls: vi.fn(async () => {
          events.push(`observation:${elapsedMs}`);
          if (elapsedMs < 1_000) return [];
          return [
            {
              callSid: "opaque-composed-call",
              direction: "inbound",
              status: elapsedMs < 2_000 ? "in-progress" : "completed",
            },
          ];
        }),
      };
      const control = createTwilioLiveSmokeControl({
        transport,
        digestProviderCall: () => "a".repeat(64),
        restingConfiguration: keepWebhook
          ? liveConfiguration
          : { voiceUrl: "https://reject.invalid/voice", statusCallbackUrl: null },
        liveConfiguration,
        now: () => new Date(baseTime + elapsedMs).toISOString(),
        wait: async (milliseconds) => {
          elapsedMs += milliseconds;
        },
      });
      const coordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
        organizationId: OrganizationId.create("org-composed-durable"),
        authorizations: durable.repository,
        control,
        keepWebhook,
        createOwnerDigest: () => "b".repeat(64),
        now: () => new Date(baseTime + elapsedMs).toISOString(),
        wait: async (milliseconds: number) => {
          elapsedMs += milliseconds;
        },
        cleanupTimeoutMs: 5_000,
        trailingCallbackGraceMs: 500,
        closeRunGate: () => events.push("gate-closed"),
        clearRuntimeSecrets: () => events.push("secrets-cleared"),
        stopHost: async () => events.push("host-stopped"),
        stopTunnel: async () => {
          events.push("tunnel-stopped");
          return "stopped" as const;
        },
        teardownPersistence: async () => events.push("persistence-stopped"),
      });
      const createControlTransport = vi.fn(() => transport);
      const createControl = vi.fn(() => control);
      const submitAndWait = vi.fn(async () => {
        durable.row["dispatchClaimedAt"] = new Date(baseTime).toISOString();
        durable.row["providerDispatchIdentity"] = "a".repeat(64);
        return { status: "completed" as const };
      });
      const process = createGuardedLiveSmokeProcess({
        preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
        confirm: vi.fn(async () => true),
        createRunGate: () => createLiveSmokeRunGate("CLOSED"),
        createControlTransport,
        createControl,
        startGuardedRuntime: vi.fn(async () => ({
          baseUrl: "http://127.0.0.1:43111",
          close: vi.fn(async () => undefined),
        })),
        cleanup: async (context) => await coordinator.execute(context),
        mintAndReserve: vi.fn(async () => ({
          operationId: "operation-composed-durable",
          permit: "opaque",
        })),
        attachViewer: vi.fn(async () => "attached" as const),
        submitAndWait,
        now: () => new Date(baseTime + elapsedMs).toISOString(),
      });

      await expect(
        process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
      ).resolves.toEqual({ status: "completed" });
      expect(durable.history).toEqual([
        "barrier_pending",
        "awaiting_arrival",
        "awaiting_terminal",
        "awaiting_grace",
        "restoration_ready",
        "restoration_started",
        "restored",
        "secrets_revoked",
        "host_stopped",
        "tunnel_stopped",
        "complete",
      ]);
      expect(durable.row).toMatchObject({
        cleanupDeadlineAt: "2026-08-28T04:00:05.000Z",
        cleanupGraceUntilAt: "2026-08-28T04:00:02.500Z",
        cleanupTerminalStatus: "completed",
        cleanupState: "complete",
      });
      expect(createControlTransport).toHaveBeenCalledOnce();
      expect(createControl).toHaveBeenCalledOnce();
      expect(submitAndWait).toHaveBeenCalledOnce();
      expect(transport.updateConfiguration).toHaveBeenCalledTimes(keepWebhook ? 1 : 2);
      if (keepWebhook) {
        expect(configuration).toEqual(liveConfiguration);
        expect(events).not.toContain("configuration-restored");
      }
      expect(events).toEqual(
        expect.arrayContaining([
          "configuration-armed",
          "gate-closed",
          ...(keepWebhook ? [] : ["configuration-restored"]),
          "secrets-cleared",
          "host-stopped",
          "tunnel-stopped",
          "persistence-stopped",
        ]),
      );
    },
  );

  it("retains only the explicitly session-owned tunnel in persistent mode", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    expect(api["createGuardedTwilioWebhookPolicy"]).toBeTypeOf("function");
    const stopTunnel = vi.fn(async () => "stopped");
    const persistent = api["createGuardedTwilioWebhookPolicy"]!(
      { SIMULATOR_PERSISTENT_WEBHOOK: "true" },
      "https://demo.invalid",
      stopTunnel,
    );
    expect(persistent.keepWebhook).toBe(true);
    expect(persistent.restingConfiguration).toEqual({
      voiceUrl: "https://demo.invalid/twilio/voice",
      statusCallbackUrl: "https://demo.invalid/twilio/status",
    });
    expect(persistent.liveConfiguration).toEqual(persistent.restingConfiguration);
    await persistent.stopTunnel();
    expect(stopTunnel).not.toHaveBeenCalled();
    const normal = api["createGuardedTwilioWebhookPolicy"]!(
      { TWILIO_RESTING_REJECT_URL: "https://reject.invalid/voice" },
      "https://demo.invalid",
      stopTunnel,
    );
    expect(normal.keepWebhook).toBe(false);
    expect(normal.restingConfiguration).toEqual({
      voiceUrl: "https://reject.invalid/voice",
      statusCallbackUrl: null,
    });
    await normal.stopTunnel();
    expect(stopTunnel).toHaveBeenCalledOnce();
    expect(() =>
      api["createGuardedTwilioWebhookPolicy"]!(
        { SIMULATOR_PERSISTENT_WEBHOOK: "yes" },
        "https://demo.invalid",
        stopTunnel,
      ),
    ).toThrow();
  });

  it("lets the persistent terminal job finish before the outer owner shuts its runtime down", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    expect(api["createGuardedTerminalPersistenceCleanup"]).toBeTypeOf("function");
    const events: string[] = [];
    const cleanup = vi.fn(async () => {
      events.push("external-cleanup");
      return { outcome: "restored" as const, hostAndTunnelMustRemainUp: false as const };
    });
    let terminalJobCleanup: (() => Promise<unknown>) | undefined;
    const runGate = createLiveSmokeRunGate();
    const process = createGuardedLiveSmokeProcess({
      preflight: { run: async () => ({ outcome: "PASS" }) },
      confirm: async () => true,
      createRunGate: () => runGate,
      createControlTransport: () => ({}),
      createControl: () => ({ arm: async () => "armed" as const, reconcile: vi.fn() }),
      startGuardedRuntime: async ({ cleanupLiveSmoke }) => {
        terminalJobCleanup = api["createGuardedTerminalPersistenceCleanup"]!({
          keepWebhook: true,
          closeRunGate: () => runGate.close(),
          cleanupLiveSmoke,
        });
        return { baseUrl: "http://127.0.0.1:43111", close: vi.fn() };
      },
      cleanup,
      mintAndReserve: async () => ({ operationId: "operation-job-lifecycle", permit: "opaque" }),
      attachViewer: async () => "attached",
      submitAndWait: async () => {
        await terminalJobCleanup!();
        expect(runGate.state()).toBe("CLOSED");
        expect(cleanup).not.toHaveBeenCalled();
        events.push("terminal-job-finished");
        events.push("projection-retained");
        return { status: "completed" as const };
      },
    });
    await expect(
      process.run({ scenarioId: "synthetic-normal", scenarioRevision: 2 }),
    ).resolves.toEqual({ status: "completed" });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(events).toEqual(["terminal-job-finished", "projection-retained", "external-cleanup"]);
    const defaultCleanup = vi.fn(async () => "default-result");
    const defaultClose = vi.fn();
    await expect(
      api["createGuardedTerminalPersistenceCleanup"]!({
        keepWebhook: false,
        closeRunGate: defaultClose,
        cleanupLiveSmoke: defaultCleanup,
      })(),
    ).resolves.toBe("default-result");
    expect(defaultCleanup).toHaveBeenCalledOnce();
    expect(defaultClose).not.toHaveBeenCalled();
  });

  it.each([
    { keepWebhook: true, configurationState: "ambiguous" },
    { keepWebhook: true, configurationState: "live" },
    { keepWebhook: false, configurationState: "resting" },
  ])(
    "does not accept unverified persistent cleanup or change default behavior: %j",
    async ({ keepWebhook, configurationState }) => {
      const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
        Record<string, CallableFunction>
      >;
      const baseTime = "2026-08-28T04:00:00.000Z";
      const durable = createDurableAuthorizationFake({
        operationId: "operation-policy",
        dispatchClaimedAt: baseTime,
        providerDispatchIdentity: "a".repeat(64),
        dispatchClosedAt: baseTime,
        cleanupState: "restoration_ready",
        cleanupDeadlineAt: "2026-08-28T04:01:00.000Z",
        cleanupStateChangedAt: baseTime,
        ownerDigest: "b".repeat(64),
      });
      const restore = vi.fn();
      const stopHost = vi.fn();
      const coordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
        organizationId: OrganizationId.create("org-composed-durable"),
        authorizations: durable.repository,
        keepWebhook,
        control: {
          observeExactCall: vi.fn(),
          readConfigurationState: vi.fn(async () => configurationState),
          restore,
        },
        createOwnerDigest: () => "b".repeat(64),
        now: () => baseTime,
        wait: vi.fn(),
        cleanupTimeoutMs: 1_000,
        trailingCallbackGraceMs: 100,
        closeRunGate: vi.fn(),
        clearRuntimeSecrets: vi.fn(),
        stopHost,
        stopTunnel: vi.fn(),
        teardownPersistence: vi.fn(),
      });
      await expect(
        coordinator.execute({
          operationId: "operation-policy",
          admission: "indeterminate",
          previousOwnerStopped: false,
        }),
      ).resolves.toEqual({ outcome: "blocked", hostAndTunnelMustRemainUp: true });
      expect(restore).not.toHaveBeenCalled();
      expect(stopHost).not.toHaveBeenCalled();
    },
  );

  it("proves durable zero-dispatch and ambiguous identity retention without provider construction", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const baseTime = Date.parse("2026-08-28T04:10:00.000Z");
    const effects = {
      observeExactCall: vi.fn(),
      restore: vi.fn(async () => "restored" as const),
      readConfigurationState: vi
        .fn()
        .mockResolvedValueOnce("live" as const)
        .mockResolvedValue("resting" as const),
      clear: vi.fn(),
      host: vi.fn(async () => undefined),
      tunnel: vi.fn(async () => "stopped" as const),
      persistence: vi.fn(async () => undefined),
    };
    const zero = createDurableAuthorizationFake({ operationId: "operation-zero-durable" });
    const zeroCoordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
      organizationId: OrganizationId.create("org-composed-durable"),
      authorizations: zero.repository,
      control: effects,
      createOwnerDigest: () => "c".repeat(64),
      now: () => new Date(baseTime).toISOString(),
      wait: vi.fn(),
      cleanupTimeoutMs: 1_000,
      trailingCallbackGraceMs: 100,
      closeRunGate: vi.fn(),
      clearRuntimeSecrets: effects.clear,
      stopHost: effects.host,
      stopTunnel: effects.tunnel,
      teardownPersistence: effects.persistence,
    });
    await expect(
      zeroCoordinator.execute({
        operationId: "operation-zero-durable",
        admission: "indeterminate",
        previousOwnerStopped: false,
      }),
    ).resolves.toMatchObject({ outcome: "restored" });
    expect(effects.observeExactCall).not.toHaveBeenCalled();

    const alreadyResting = createDurableAuthorizationFake({
      operationId: "operation-zero-already-resting",
    });
    const alreadyRestingEffects = {
      observeExactCall: vi.fn(),
      restore: vi.fn(async () => "restored" as const),
      readConfigurationState: vi.fn(async () => "resting" as const),
      clear: vi.fn(),
      host: vi.fn(async () => undefined),
      tunnel: vi.fn(async () => "stopped" as const),
      persistence: vi.fn(async () => undefined),
    };
    const alreadyRestingCoordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
      organizationId: OrganizationId.create("org-composed-durable"),
      authorizations: alreadyResting.repository,
      control: alreadyRestingEffects,
      createOwnerDigest: () => "e".repeat(64),
      now: () => new Date(baseTime).toISOString(),
      wait: vi.fn(),
      cleanupTimeoutMs: 1_000,
      trailingCallbackGraceMs: 100,
      closeRunGate: vi.fn(),
      clearRuntimeSecrets: alreadyRestingEffects.clear,
      stopHost: alreadyRestingEffects.host,
      stopTunnel: alreadyRestingEffects.tunnel,
      teardownPersistence: alreadyRestingEffects.persistence,
    });
    await expect(
      alreadyRestingCoordinator.execute({
        operationId: "operation-zero-already-resting",
        admission: "not_started",
        previousOwnerStopped: false,
      }),
    ).resolves.toMatchObject({ outcome: "restored" });
    expect(alreadyRestingEffects.restore).not.toHaveBeenCalled();
    expect(alreadyResting.history).toEqual([
      "barrier_pending",
      "restoration_ready",
      "restoration_started",
      "restored",
      "secrets_revoked",
      "host_stopped",
      "tunnel_stopped",
      "complete",
    ]);

    let elapsedMs = 0;
    const ambiguous = createDurableAuthorizationFake({
      operationId: "operation-ambiguous-durable",
      dispatchClaimedAt: new Date(baseTime).toISOString(),
    });
    const ambiguousCoordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
      organizationId: OrganizationId.create("org-composed-durable"),
      authorizations: ambiguous.repository,
      control: effects,
      createOwnerDigest: () => "d".repeat(64),
      now: () => new Date(baseTime + elapsedMs).toISOString(),
      wait: async (milliseconds: number) => {
        elapsedMs += milliseconds;
      },
      cleanupTimeoutMs: 1_000,
      trailingCallbackGraceMs: 100,
      closeRunGate: vi.fn(),
      clearRuntimeSecrets: effects.clear,
      stopHost: effects.host,
      stopTunnel: effects.tunnel,
      teardownPersistence: effects.persistence,
    });
    const effectCountBeforeAmbiguous =
      effects.restore.mock.calls.length +
      effects.clear.mock.calls.length +
      effects.host.mock.calls.length +
      effects.tunnel.mock.calls.length;
    await expect(
      ambiguousCoordinator.execute({
        operationId: "operation-ambiguous-durable",
        admission: "indeterminate",
        previousOwnerStopped: false,
      }),
    ).resolves.toEqual({ outcome: "blocked", hostAndTunnelMustRemainUp: true });
    expect(ambiguous.history).toEqual(["barrier_pending", "awaiting_identity", "blocked"]);
    expect(effects.observeExactCall).not.toHaveBeenCalled();
    expect(
      effects.restore.mock.calls.length +
        effects.clear.mock.calls.length +
        effects.host.mock.calls.length +
        effects.tunnel.mock.calls.length,
    ).toBe(effectCountBeforeAmbiguous);
  });

  it("resumes persisted grace only after stopped-owner confirmation without resetting its deadline", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const baseTime = Date.parse("2026-08-28T04:20:00.000Z");
    let elapsedMs = 500;
    const durable = createDurableAuthorizationFake({
      operationId: "operation-resume-grace",
      dispatchClaimedAt: new Date(baseTime).toISOString(),
      providerDispatchIdentity: "a".repeat(64),
      dispatchClosedAt: new Date(baseTime).toISOString(),
      cleanupState: "awaiting_grace",
      cleanupDeadlineAt: new Date(baseTime + 2_000).toISOString(),
      cleanupGraceUntilAt: new Date(baseTime + 1_000).toISOString(),
      cleanupTerminalStatus: "completed",
      cleanupStateChangedAt: new Date(baseTime + 250).toISOString(),
      ownerDigest: "e".repeat(64),
    });
    const effects: string[] = [];
    const createCoordinator = (ownerDigest: string) =>
      api["createDurableGuardedRuntimeCleanupCoordinator"]!({
        organizationId: OrganizationId.create("org-composed-durable"),
        authorizations: durable.repository,
        control: {
          observeExactCall: vi.fn(async () => ({
            outcome: "exact_terminal" as const,
            status: "completed" as const,
          })),
          readConfigurationState: vi
            .fn()
            .mockResolvedValueOnce("live" as const)
            .mockResolvedValue("resting" as const),
          restore: vi.fn(async () => "restored" as const),
        },
        createOwnerDigest: () => ownerDigest,
        now: () => new Date(baseTime + elapsedMs).toISOString(),
        wait: async (milliseconds: number) => {
          elapsedMs += milliseconds;
        },
        cleanupTimeoutMs: 60_000,
        trailingCallbackGraceMs: 5_000,
        closeRunGate: vi.fn(),
        clearRuntimeSecrets: () => effects.push("clear"),
        stopHost: async () => effects.push("host"),
        stopTunnel: async () => {
          effects.push("tunnel");
          return "stopped" as const;
        },
        teardownPersistence: async () => effects.push("persistence"),
      });

    await expect(
      createCoordinator("f".repeat(64)).execute({
        operationId: "operation-resume-grace",
        admission: "indeterminate",
        previousOwnerStopped: false,
      }),
    ).resolves.toEqual({ outcome: "blocked", hostAndTunnelMustRemainUp: true });
    expect(durable.repository.takeOverCleanup).not.toHaveBeenCalled();
    expect(effects).toEqual([]);

    await expect(
      createCoordinator("1".repeat(64)).execute({
        operationId: "operation-resume-grace",
        admission: "indeterminate",
        previousOwnerStopped: true,
      }),
    ).resolves.toMatchObject({ outcome: "restored" });
    expect(durable.repository.takeOverCleanup).toHaveBeenCalledOnce();
    expect(durable.row).toMatchObject({
      cleanupDeadlineAt: "2026-08-28T04:20:02.000Z",
      cleanupGraceUntilAt: "2026-08-28T04:20:01.000Z",
      cleanupTerminalStatus: "completed",
      cleanupState: "complete",
    });
  });

  it("recovers terminal and post-restoration checkpoints without replaying completed effects", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const baseTime = "2026-08-28T04:30:00.000Z";
    const scenarios = [
      { state: "blocked", result: "blocked", reads: 0, restores: 0, clear: 0, host: 0, tunnel: 0 },
      {
        state: "complete",
        result: "restored",
        reads: 0,
        restores: 0,
        clear: 0,
        host: 0,
        tunnel: 0,
      },
      {
        state: "restoration_ready",
        result: "restored",
        reads: 2,
        restores: 1,
        clear: 1,
        host: 1,
        tunnel: 1,
      },
      {
        state: "restoration_started",
        result: "restored",
        reads: 1,
        restores: 0,
        clear: 1,
        host: 1,
        tunnel: 1,
      },
      {
        state: "restored",
        result: "restored",
        reads: 0,
        restores: 0,
        clear: 1,
        host: 1,
        tunnel: 1,
      },
      {
        state: "secrets_revoked",
        result: "restored",
        reads: 0,
        restores: 0,
        clear: 0,
        host: 1,
        tunnel: 1,
      },
      {
        state: "host_stopped",
        result: "restored",
        reads: 0,
        restores: 0,
        clear: 0,
        host: 0,
        tunnel: 1,
      },
      {
        state: "tunnel_stopped",
        result: "restored",
        reads: 0,
        restores: 0,
        clear: 0,
        host: 0,
        tunnel: 0,
      },
    ] as const;

    for (const scenario of scenarios) {
      const durable = createDurableAuthorizationFake({
        operationId: `operation-checkpoint-${scenario.state}`,
        dispatchClaimedAt: baseTime,
        providerDispatchIdentity: "a".repeat(64),
        dispatchClosedAt: baseTime,
        cleanupState: scenario.state,
        cleanupDeadlineAt: "2026-08-28T04:31:00.000Z",
        cleanupStateChangedAt: baseTime,
        ownerDigest: "2".repeat(64),
      });
      let configurationReads = 0;
      const readConfigurationState = vi.fn(async () => {
        configurationReads += 1;
        return scenario.state === "restoration_ready" && configurationReads === 1
          ? ("live" as const)
          : ("resting" as const);
      });
      const restore = vi.fn(async () => "restored" as const);
      const clearRuntimeSecrets = vi.fn();
      const stopHost = vi.fn(async () => undefined);
      const stopTunnel = vi.fn(async () => "stopped" as const);
      const coordinator = api["createDurableGuardedRuntimeCleanupCoordinator"]!({
        organizationId: OrganizationId.create("org-composed-durable"),
        authorizations: durable.repository,
        control: { observeExactCall: vi.fn(), readConfigurationState, restore },
        createOwnerDigest: () => "3".repeat(64),
        now: () => baseTime,
        wait: vi.fn(),
        cleanupTimeoutMs: 60_000,
        trailingCallbackGraceMs: 5_000,
        closeRunGate: vi.fn(),
        clearRuntimeSecrets,
        stopHost,
        stopTunnel,
        teardownPersistence: vi.fn(async () => undefined),
      });

      await expect(
        coordinator.execute({
          operationId: `operation-checkpoint-${scenario.state}`,
          admission: "indeterminate",
          previousOwnerStopped: true,
        }),
      ).resolves.toMatchObject({ outcome: scenario.result });
      expect(readConfigurationState).toHaveBeenCalledTimes(scenario.reads);
      expect(restore).toHaveBeenCalledTimes(scenario.restores);
      expect(clearRuntimeSecrets).toHaveBeenCalledTimes(scenario.clear);
      expect(stopHost).toHaveBeenCalledTimes(scenario.host);
      expect(stopTunnel).toHaveBeenCalledTimes(scenario.tunnel);
    }
  });

  it("AC-ERROR-2 blocks reconstructed process state before every cleanup side effect", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    expect(api["createGuardedRuntimePreRestorationBarrier"]).toBeTypeOf("function");
    const findProviderDispatchIdentity = vi.fn(async () => "a".repeat(64));
    const awaitExactCallQuiescence = vi.fn(async () => "quiescent" as const);
    const awaitPreRestorationBarrier = api["createGuardedRuntimePreRestorationBarrier"]!({
      readProcessState: () => ({ callMayBeActive: false }),
      findProviderDispatchIdentity,
      awaitExactCallQuiescence,
    });
    const restoreTwilio = vi.fn(async () => undefined);
    const verifyTwilioResting = vi.fn(async () => true);
    const clearRuntimeSecrets = vi.fn();
    const stopHost = vi.fn(async () => undefined);
    const stopTunnel = vi.fn(async () => undefined);
    const teardownPersistence = vi.fn(async () => undefined);
    const cleanup = createGuardedRuntimeCleanupOwner({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier,
      restoreTwilio,
      verifyTwilioResting,
      clearRuntimeSecrets,
      stopHost,
      stopTunnel,
      teardownPersistence,
    });

    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(findProviderDispatchIdentity).not.toHaveBeenCalled();
    expect(awaitExactCallQuiescence).not.toHaveBeenCalled();
    expect(restoreTwilio).not.toHaveBeenCalled();
    expect(verifyTwilioResting).not.toHaveBeenCalled();
    expect(clearRuntimeSecrets).not.toHaveBeenCalled();
    expect(stopHost).not.toHaveBeenCalled();
    expect(stopTunnel).not.toHaveBeenCalled();
    expect(teardownPersistence).not.toHaveBeenCalled();
  });

  it("returns exact-call proof only after the composed quiescence observation", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const awaitExactCallQuiescence = vi.fn(async () => "quiescent" as const);
    const barrier = api["createGuardedRuntimePreRestorationBarrier"]!({
      readProcessState: () => ({
        callMayBeActive: true,
        activeRunStartedAt: "2026-08-27T20:00:00.000Z",
        activeOperationId: "operation-test",
      }),
      findProviderDispatchIdentity: vi.fn(async () => "a".repeat(64)),
      awaitExactCallQuiescence,
    });

    await expect(barrier()).resolves.toEqual({
      outcome: "ready",
      proof: "exact_call_quiescent",
    });
    expect(awaitExactCallQuiescence).toHaveBeenCalledWith({
      startedAt: "2026-08-27T20:00:00.000Z",
      boundCallDigest: "a".repeat(64),
    });
  });

  it("revokes control, authorization, and provider secrets before host and tunnel shutdown", async () => {
    const secrets = createGuardedRuntimeSecretOwner({
      apiToken: "test-only-provider-token",
      authorizationSigningKey: "test-only-signing-key",
      callbackIdentityHmacKey: "test-only-callback-key",
      twilioAuthToken: "test-only-control-token",
    });
    const order: string[] = [];
    const cleanup = createGuardedRuntimeCleanupOwner({
      closeRunGate: () => order.push("gate-closed"),
      awaitPreRestorationBarrier: async () => {
        order.push("zero-dispatch-proven");
        return { outcome: "ready", proof: "zero_dispatch" };
      },
      restoreTwilio: async () => order.push("twilio-restored"),
      verifyTwilioResting: async () => true,
      clearRuntimeSecrets: () => {
        secrets.clear();
        order.push("secrets-cleared");
      },
      stopHost: async () => {
        order.push("host-stopped");
        expect(() => secrets.access()).toThrow("Live-smoke runtime is unavailable");
      },
      stopTunnel: async () => {
        order.push("tunnel-stopped");
        expect(() => secrets.access()).toThrow("Live-smoke runtime is unavailable");
      },
      teardownPersistence: vi.fn(async () => order.push("persistence-stopped")),
    });

    expect(secrets.access()).toMatchObject({
      apiToken: "test-only-provider-token",
      authorizationSigningKey: "test-only-signing-key",
      twilioAuthToken: "test-only-control-token",
    });
    await expect(cleanup.execute()).resolves.toEqual({
      outcome: "restored",
      hostAndTunnelMustRemainUp: false,
    });
    expect(order).toEqual([
      "gate-closed",
      "zero-dispatch-proven",
      "twilio-restored",
      "secrets-cleared",
      "host-stopped",
      "tunnel-stopped",
      "persistence-stopped",
    ]);
    expect(() => secrets.access()).toThrow("Live-smoke runtime is unavailable");
  });

  it("starts retained review only after causal external cleanup closes every provider capability", async () => {
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const order: string[] = [];
    const transition = api["createRecordingSafeReviewTransition"]!({
      closeRunGate: () => order.push("gate-closed"),
      awaitPreRestorationBarrier: async () => {
        order.push("exact-dispatch-quiescent");
        return { outcome: "ready", proof: "exact_call_quiescent" };
      },
      restoreTwilio: async () => order.push("reject-restored"),
      verifyTwilioResting: async () => {
        order.push("reject-read-back");
        return true;
      },
      clearRuntimeSecrets: () => order.push("secrets-revoked"),
      stopHost: async () => order.push("call-host-stopped"),
      stopTunnel: async () => order.push("owned-tunnel-stopped"),
      retainReviewResources: () => order.push("review-resources-retained"),
      startReviewRuntime: async () => {
        order.push("review-ready");
        return { baseUrl: "http://127.0.0.1:43123" };
      },
    });

    await expect(transition.execute()).resolves.toEqual({
      outcome: "review_ready",
      message: "External call capability closed—review available for 30 minutes",
      review: { baseUrl: "http://127.0.0.1:43123" },
    });
    expect(order).toEqual([
      "gate-closed",
      "exact-dispatch-quiescent",
      "reject-restored",
      "reject-read-back",
      "secrets-revoked",
      "call-host-stopped",
      "owned-tunnel-stopped",
      "review-resources-retained",
      "review-ready",
    ]);
  });

  it("does not retain resources or start review when any external cleanup proof is blocked", async () => {
    const retainReviewResources = vi.fn();
    const startReviewRuntime = vi.fn(async () => ({ baseUrl: "http://127.0.0.1:43123" }));
    const transition = createRecordingSafeReviewTransition({
      closeRunGate: vi.fn(),
      awaitPreRestorationBarrier: async () => ({
        outcome: "blocked" as const,
        reason: "dispatch_ambiguous" as const,
      }),
      restoreTwilio: vi.fn(),
      verifyTwilioResting: vi.fn(),
      clearRuntimeSecrets: vi.fn(),
      stopHost: vi.fn(),
      stopTunnel: vi.fn(),
      retainReviewResources,
      startReviewRuntime,
    });

    await expect(transition.execute()).resolves.toEqual({
      outcome: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(retainReviewResources).not.toHaveBeenCalled();
    expect(startReviewRuntime).not.toHaveBeenCalled();
  });

  it.each(["checkpoint", "custody marker", "database lease", "observability", "listener"] as const)(
    "converts real %s review startup failure into exact cleanup and revokes every retained resource",
    async (stage) => {
      const events: string[] = [];
      const revokeProjection = vi.fn(() => events.push("projection-revoked"));
      const closePartialRuntime = vi.fn(async () => events.push("partial-runtime-closed"));
      const closeObservability = vi.fn(async () => events.push("observability-closed"));
      const cleanupFailedReview = vi.fn(async () => {
        events.push("protected-cleanup-deleted");
        return {
          outcome: "deleted" as const,
          message: "Protected demo result deleted" as const,
        };
      });
      const transition = createRecordingSafeReviewTransition({
        executeExternalCleanup: async () => ({
          outcome: "restored" as const,
          hostAndTunnelMustRemainUp: false as const,
        }),
        retainReviewResources: async () => undefined,
        startReviewRuntime: async () => {
          throw new Error(`synthetic ${stage} startup refusal`);
        },
        cleanupFailedReview,
        releaseFailedReviewResources: async () => {
          if (stage === "listener") await closePartialRuntime();
          if (stage === "observability" || stage === "listener") await closeObservability();
          revokeProjection();
        },
      });

      await expect(transition.execute()).resolves.toEqual({
        outcome: "review_startup_cleaned",
        message: "Review startup failed; protected demo result deleted",
      });
      await expect(transition.execute()).resolves.toEqual({
        outcome: "review_startup_cleaned",
        message: "Review startup failed; protected demo result deleted",
      });
      expect(cleanupFailedReview).toHaveBeenCalledOnce();
      expect(revokeProjection).toHaveBeenCalledOnce();
      expect(closePartialRuntime).toHaveBeenCalledTimes(stage === "listener" ? 1 : 0);
      expect(closeObservability).toHaveBeenCalledTimes(
        stage === "observability" || stage === "listener" ? 1 : 0,
      );
      expect(events[0]).toBe("protected-cleanup-deleted");
      expect(events.at(-1)).toBe("projection-revoked");
    },
  );

  it("returns a typed bounded recovery result when review startup cleanup is blocked", async () => {
    const recoveryIdentity = {
      sessionId: "review-session-startup-blocked",
      operationId: "operation-startup-blocked",
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
      reviewReadyAt: "2026-09-01T16:00:00.000Z",
      reviewExpiresAt: "2026-09-01T16:30:00.000Z",
      custodyOwnershipDigest: "a".repeat(64),
      databaseOwnershipDigest: "b".repeat(64),
    };
    const transition = createRecordingSafeReviewTransition({
      executeExternalCleanup: async () => ({
        outcome: "restored" as const,
        hostAndTunnelMustRemainUp: false as const,
      }),
      retainReviewResources: async () => undefined,
      startReviewRuntime: async () => {
        throw new Error("synthetic listener refusal");
      },
      cleanupFailedReview: async () => ({
        outcome: "blocked" as const,
        message: "Cleanup requires attention" as const,
        recoveryIdentity,
      }),
    });

    await expect(transition.execute()).resolves.toEqual({
      outcome: "review_cleanup_blocked",
      message: "Cleanup requires attention",
      recoveryIdentity,
    });
  });

  it.each([
    ["runtime", true, false, ["runtime"]],
    ["observability", false, true, ["observability"]],
    ["runtime and observability", true, true, ["runtime", "observability"]],
  ] as const)(
    "revokes protected startup state before fallible %s close and reports every failure truthfully",
    async (_case, runtimeRejects, observabilityRejects, expectedFailures) => {
      const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
        Record<string, CallableFunction>
      >;
      expect(api["releaseFailedReviewStartupResources"]).toBeTypeOf("function");
      let projection: Readonly<{ payload: string }> | undefined = Object.freeze({
        payload: "protected",
      });
      let retainedRuntime: Readonly<{ close(): Promise<void> }> | undefined;
      let retainedObservability: Readonly<{ close(): Promise<void> }> | undefined;
      const runtimeClose = vi.fn(async () => {
        expect(projection).toBeUndefined();
        expect(retainedRuntime).toBeUndefined();
        expect(retainedObservability).toBeUndefined();
        if (runtimeRejects) throw new Error("synthetic runtime close refusal");
      });
      const observabilityClose = vi.fn(async () => {
        expect(projection).toBeUndefined();
        expect(retainedRuntime).toBeUndefined();
        expect(retainedObservability).toBeUndefined();
        if (observabilityRejects) throw new Error("synthetic observability close refusal");
      });
      retainedRuntime = Object.freeze({ close: runtimeClose });
      retainedObservability = Object.freeze({ close: observabilityClose });
      const transition = createRecordingSafeReviewTransition({
        executeExternalCleanup: async () => ({
          outcome: "restored" as const,
          hostAndTunnelMustRemainUp: false as const,
        }),
        retainReviewResources: async () => undefined,
        startReviewRuntime: async () => {
          throw new Error("synthetic post-observability startup refusal");
        },
        cleanupFailedReview: async () => ({
          outcome: "deleted" as const,
          message: "Protected demo result deleted" as const,
        }),
        releaseFailedReviewResources: async () =>
          await api["releaseFailedReviewStartupResources"]!({
            revokeProtectedState: () => {
              projection = undefined;
            },
            detachRuntime: () => {
              const detached = retainedRuntime;
              retainedRuntime = undefined;
              return detached;
            },
            detachObservability: () => {
              const detached = retainedObservability;
              retainedObservability = undefined;
              return detached;
            },
          }),
      });

      await expect(transition.execute()).resolves.toEqual({
        outcome: "review_startup_release_failed",
        message:
          "Review startup failed; protected demo result deleted; local resource close requires attention",
        protectedStateRevoked: true,
        closeFailures: expectedFailures,
      });
      expect(projection).toBeUndefined();
      expect(retainedRuntime).toBeUndefined();
      expect(retainedObservability).toBeUndefined();
      expect(runtimeClose).toHaveBeenCalledOnce();
      expect(observabilityClose).toHaveBeenCalledOnce();
    },
  );

  it("retains one review cleanup handle for interrupt and requires recovery before later preflight", async () => {
    const reviewCleanup = vi.fn(async (trigger: "interrupt" | "restart") => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
      trigger,
    }));
    const api = (await import("./guarded-live-smoke-runtime.js")) as Readonly<
      Record<string, CallableFunction>
    >;
    const lifecycle = api["createGuardedReviewLifecycle"]!({
      discoverPendingReview: async () => ({ outcome: "pending" }),
      recoverPendingReview: async () => await reviewCleanup("restart"),
    });

    await expect(lifecycle.recoverBeforePreflight()).resolves.toMatchObject({
      outcome: "deleted",
      trigger: "restart",
    });
    lifecycle.retainCleanupHandle(reviewCleanup);
    await expect(lifecycle.shutdown()).resolves.toMatchObject({
      outcome: "deleted",
      trigger: "interrupt",
    });
    expect(reviewCleanup.mock.calls.map(([trigger]) => trigger)).toEqual(["restart", "interrupt"]);
  });

  it("wires the recording-safe transition into the real default supervisor path", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./guarded-live-smoke-runtime.ts", import.meta.url),
      "utf8",
    );
    const defaultSupervisor = source.slice(
      source.indexOf("export function createDefaultGuardedLiveSmokeProcess"),
      source.indexOf("function parseRun"),
    );

    expect(defaultSupervisor).toContain("createRecordingSafeReviewTransition");
    expect(defaultSupervisor).toContain("startBoundLiveDemoReviewRuntime");
    expect(defaultSupervisor).toContain("createLiveDemoReviewProtectedCleanupBinding");
    expect(defaultSupervisor).toContain("createGuardedReviewLifecycle");
    expect(defaultSupervisor).toContain("recoverBeforePreflight");
    expect(defaultSupervisor).toContain("retainCleanupHandle");
    expect(defaultSupervisor).toContain("writeCustodyOwnershipMarker");
    expect(defaultSupervisor).toContain("disposableDatabaseOwner");
    expect(defaultSupervisor).toContain("releaseFailedReviewResources");
    expect(defaultSupervisor).toContain("databaseProvisioningOwnershipDigest");
    expect(defaultSupervisor).toContain("shutdownAfterRun");
    expect(defaultSupervisor).not.toMatch(
      /teardownPersistence:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?cleanupCoordinator/u,
    );
  });
});
