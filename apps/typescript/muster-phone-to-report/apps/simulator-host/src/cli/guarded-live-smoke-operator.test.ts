import { describe, expect, it, vi } from "vitest";

import { createGuardedLiveSmokeOperator } from "./guarded-live-smoke-operator.js";

describe("guarded live-smoke operator", () => {
  it("owns prepare -> fresh confirmation -> arm/read-back -> gate -> mint/reserve -> one run -> cleanup", async () => {
    const order: string[] = [];
    const operator = createGuardedLiveSmokeOperator({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: () => {
        order.push("fresh-confirmation");
        return { kind: "receipt" };
      },
      arm: vi.fn(async () => {
        order.push("arm-readback-gate-mint-reserve");
        return { outcome: "armed" as const };
      }),
      execute: vi.fn(async () => {
        order.push("execute");
        return { status: "completed" as const };
      }),
      cleanup: vi.fn(async () => {
        order.push("cleanup");
        return { outcome: "restored" as const, hostAndTunnelMustRemainUp: false as const };
      }),
    });

    await expect(operator.prepare()).resolves.toMatchObject({ outcome: "PASS" });
    await expect(operator.run({ operationId: "operation-guarded" })).resolves.toMatchObject({
      status: "completed",
    });
    expect(order).toEqual([
      "fresh-confirmation",
      "arm-readback-gate-mint-reserve",
      "execute",
      "cleanup",
    ]);
  });

  it("never executes after a blocked arm and still delegates to the single cleanup owner", async () => {
    const execute = vi.fn();
    const cleanup = vi.fn(async () => ({
      outcome: "blocked" as const,
      hostAndTunnelMustRemainUp: true as const,
    }));
    const operator = createGuardedLiveSmokeOperator({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: () => ({ kind: "receipt" }),
      arm: vi.fn(async () => ({ outcome: "blocked" as const })),
      execute,
      cleanup,
    });

    await expect(operator.run({ operationId: "operation-blocked" })).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not ask for confirmation when the immediate preflight is blocked", async () => {
    const confirm = vi.fn(() => ({ kind: "receipt" }));
    const arm = vi.fn();
    const execute = vi.fn();
    const operator = createGuardedLiveSmokeOperator({
      preflight: { run: vi.fn(async () => ({ outcome: "BLOCKED" as const })) },
      confirm,
      arm,
      execute,
      cleanup: vi.fn(),
    });

    await expect(operator.run({ operationId: "operation-blocked" })).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(arm).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a blocked cleanup as the terminal result even after successful execution", async () => {
    const operator = createGuardedLiveSmokeOperator({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: () => ({ kind: "receipt" }),
      arm: vi.fn(async () => ({ outcome: "armed" as const })),
      execute: vi.fn(async () => ({ status: "completed" as const })),
      cleanup: vi.fn(async () => ({
        outcome: "blocked" as const,
        hostAndTunnelMustRemainUp: true as const,
      })),
    });

    await expect(operator.run({ operationId: "operation-cleanup-blocked" })).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
  });

  it("runs cleanup after a later execution failure and preserves teardown escalation", async () => {
    const cleanup = vi.fn(async () => ({
      outcome: "blocked" as const,
      hostAndTunnelMustRemainUp: true as const,
    }));
    const operator = createGuardedLiveSmokeOperator({
      preflight: { run: vi.fn(async () => ({ outcome: "PASS" as const })) },
      confirm: () => ({ kind: "receipt" }),
      arm: vi.fn(async () => ({ outcome: "armed" as const })),
      execute: vi.fn(async () => {
        throw new Error("later failure");
      }),
      cleanup,
    });

    await expect(operator.run({ operationId: "operation-later-failure" })).resolves.toEqual({
      status: "blocked",
      hostAndTunnelMustRemainUp: true,
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
