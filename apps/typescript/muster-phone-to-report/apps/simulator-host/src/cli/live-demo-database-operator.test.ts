import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LIVE_DEMO_DATABASE_ATTENTION_MESSAGE,
  LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
  LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
} from "./live-demo-database-contract.js";
import { runLiveDemoDatabaseOperatorCommand } from "./live-demo-database-operator.js";
import { awaitLiveDemoDatabaseChildExit } from "../composition/live-demo-database-operator-runtime.js";

const repositoryRoot = path.resolve("fixture-repository");

describe("live-demo database operator command", () => {
  it("binds exact package and root start/dispose scripts", async () => {
    const [rootPackage, applicationPackage] = await Promise.all([
      readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ]);
    const rootScripts = (JSON.parse(rootPackage) as { scripts: Record<string, string> }).scripts;
    const applicationScripts = (
      JSON.parse(applicationPackage) as { scripts: Record<string, string> }
    ).scripts;

    expect(rootScripts["simulator:live-demo:database:start"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-demo:database:start",
    );
    expect(rootScripts["simulator:live-demo:database:dispose"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-demo:database:dispose",
    );
    expect(applicationScripts["live-demo:database:start"]).toBe(
      "node dist/cli/live-demo-database-main.js start",
    );
    expect(applicationScripts["live-demo:database:dispose"]).toBe(
      "node dist/cli/live-demo-database-main.js dispose",
    );
  });

  it("prints only the fixed success lines for start and dispose", async () => {
    const writeLine = vi.fn();
    const start = vi.fn(async () => ({
      outcome: "ready" as const,
      message: LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
      activationScript: path.join(
        repositoryRoot,
        ".generated-tmp",
        "live-demo-database",
        "activate.ps1",
      ),
    }));
    const dispose = vi.fn(async () => ({
      outcome: "disposed" as const,
      message: LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE,
    }));

    await expect(
      runLiveDemoDatabaseOperatorCommand({
        argv: ["start"],
        repositoryRoot,
        start,
        dispose,
        writeLine,
      }),
    ).resolves.toBe(0);
    expect(writeLine.mock.calls.map(([line]) => line)).toEqual([
      LIVE_DEMO_DATABASE_START_SUCCESS_MESSAGE,
      path.join(repositoryRoot, ".generated-tmp", "live-demo-database", "activate.ps1"),
    ]);

    writeLine.mockClear();
    await expect(
      runLiveDemoDatabaseOperatorCommand({
        argv: ["dispose"],
        repositoryRoot,
        start,
        dispose,
        writeLine,
      }),
    ).resolves.toBe(0);
    expect(writeLine).toHaveBeenCalledExactlyOnceWith(LIVE_DEMO_DATABASE_DISPOSE_SUCCESS_MESSAGE);
  });

  it("maps invalid input, thrown failures, and blocked results to one fixed attention line", async () => {
    for (const argv of [[], ["start", "unexpected"], ["unknown"]]) {
      const writeLine = vi.fn();
      await expect(
        runLiveDemoDatabaseOperatorCommand({
          argv,
          repositoryRoot,
          start: vi.fn(),
          dispose: vi.fn(),
          writeLine,
        }),
      ).resolves.toBe(1);
      expect(writeLine).toHaveBeenCalledExactlyOnceWith(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
    }

    const writeLine = vi.fn();
    await expect(
      runLiveDemoDatabaseOperatorCommand({
        argv: ["start"],
        repositoryRoot,
        start: vi.fn(async () => {
          throw new Error("must not escape");
        }),
        dispose: vi.fn(),
        writeLine,
      }),
    ).resolves.toBe(1);
    expect(writeLine).toHaveBeenCalledExactlyOnceWith(LIVE_DEMO_DATABASE_ATTENTION_MESSAGE);
  });

  it("does not return from timeout until child termination is confirmed", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
      };
      child.kill = vi.fn(() => true);
      let settled = false;
      const pending = awaitLiveDemoDatabaseChildExit(child as never, 10).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledExactlyOnceWith();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
      expect(settled).toBe(false);

      child.emit("close", 0);
      await expect(pending).resolves.toEqual({ exitCode: 1, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return from a child error until close and preserves termination escalation", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
      };
      child.kill = vi.fn(() => true);
      const childError = new Error("synthetic child error");
      let settled = false;
      const observed = awaitLiveDemoDatabaseChildExit(child as never, 10).then(
        (value) => {
          settled = true;
          return { kind: "resolved" as const, value };
        },
        (error: unknown) => {
          settled = true;
          return { kind: "rejected" as const, error };
        },
      );

      child.emit("error", childError);
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledExactlyOnceWith();
      expect(settled).toBe(false);
      expect(() => child.emit("error", new Error("synthetic escalation error"))).not.toThrow();
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
      expect(settled).toBe(false);

      child.emit("close", 1);
      await expect(observed).resolves.toEqual({ kind: "rejected", error: childError });
    } finally {
      vi.useRealTimers();
    }
  });

  it("documents activation, provider-free verification, ordering, and retained-state recovery", async () => {
    const [runbook, apiContract, systemPatterns, techContext] = await Promise.all([
      readFile(
        new URL("../../../../docs/demo/hackathon-live-calle-observation.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../../docs/api/simulator-host-live-runs.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../../docs/architecture/system-patterns.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../../docs/architecture/technical-context.md", import.meta.url),
        "utf8",
      ),
    ]);
    const operatorContract = [runbook, apiContract, systemPatterns, techContext].join("\n");

    expect(runbook).toContain("corepack pnpm simulator:live-demo:database:start");
    expect(runbook).toContain(". .\\.generated-tmp\\live-demo-database\\activate.ps1");
    expect(runbook).toContain("corepack pnpm simulator:live-smoke:prepare:verify");
    expect(runbook).toContain("corepack pnpm simulator:live-demo:database:dispose");
    expect(runbook).toMatch(/guarded cleanup.*database.*dispose/isu);
    expect(runbook).toMatch(
      /requires attention.*(?:do not|never manually) delete.*protected recovery state/isu,
    );
    expect(runbook).toMatch(/provider-free.*(?:does|do) not authorize.*call/isu);
    expect(operatorContract).toMatch(/30-second.*one-shot Docker create/isu);
    expect(operatorContract).toMatch(
      /(?:exact-name.*session-label.*at least 10 seconds|at least 10 seconds.*exact-name.*session-label)/isu,
    );
    expect(operatorContract).toMatch(/owner token.*suppressed.*inspect.*never.*arguments/isu);
    expect(operatorContract).toMatch(/persist.*container proof.*before.*docker rm/isu);
    expect(operatorContract).toMatch(/final.*absence.*before.*lifecycle state/isu);
    expect(operatorContract).toMatch(
      /cleanup_required.*dispose.*retry.*never manually delete.*never start another session/isu,
    );
    expect(operatorContract).toMatch(/provider-free.*zero provider.*does not authorize.*call/isu);
    expect(operatorContract).toMatch(
      /(?:complete|exact).*recovery source closure.*exact.*capability counts/isu,
    );
    expect(operatorContract).toMatch(
      /fixture-bound.*exact.*arguments.*working\s+directory.*empty environment.*timeout.*suppressed/isu,
    );
    expect(operatorContract).toMatch(
      /(?:exact benign.*environment.*CommonJS|CommonJS.*exact benign.*environment)/isu,
    );
  });
});
