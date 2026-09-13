import {
  getPreloadedSimulatorHostTelemetry,
  type SimulatorHostProcessTelemetry,
} from "@muster/observability";

import {
  startSimulatorHostRuntime,
  type SimulatorHostProcessRuntime,
} from "./start-simulator-host-runtime.js";

type NonProductionRuntimeProfile = "development" | "test" | "ci";

interface ProcessSignals {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface SimulatorHostProcess {
  close(): Promise<void>;
}

const DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000;

async function runProcessCleanupWithinDeadline(
  cleanup: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Simulator host process cleanup timed out"));
    }, timeoutMs);
    void Promise.resolve()
      .then(cleanup)
      .then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Simulator host process cleanup failed"));
        },
      );
  });
}

function authoritativeRuntimeProfile(
  environment: Readonly<Record<string, string | undefined>>,
  telemetry: SimulatorHostProcessTelemetry,
): NonProductionRuntimeProfile {
  const profile = environment["RUNTIME_PROFILE"];
  if (
    (profile !== "development" && profile !== "test" && profile !== "ci") ||
    telemetry.runtimeProfile !== profile
  ) {
    throw new Error("Simulator host runtime profile is invalid");
  }
  return profile;
}

function reportFailure(
  telemetry: SimulatorHostProcessTelemetry,
  phase: "startup" | "shutdown",
): void {
  try {
    telemetry.reportProcessFailure(Object.freeze({ phase }));
  } catch {
    // Telemetry reporting must not recurse or replace the process failure.
  }
}

export async function startSimulatorHostProcess(
  options: Readonly<{
    environment?: Readonly<Record<string, string | undefined>>;
    telemetry?: SimulatorHostProcessTelemetry;
    startRuntime?: (input: {
      readonly environment: Readonly<Record<string, string | undefined>>;
    }) => Promise<SimulatorHostProcessRuntime>;
    signals?: ProcessSignals;
    setExitCode?: (code: number) => void;
    shutdownTimeoutMs?: number;
  }> = {},
): Promise<SimulatorHostProcess> {
  const environment = options.environment ?? process.env;
  const telemetry = options.telemetry ?? getPreloadedSimulatorHostTelemetry();
  const startRuntime = options.startRuntime ?? startSimulatorHostRuntime;
  const signals = options.signals ?? process;
  const setExitCode = options.setExitCode ?? ((code: number) => (process.exitCode = code));
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_PROCESS_SHUTDOWN_TIMEOUT_MS;
  let closeProcess: (() => Promise<void>) | undefined;
  try {
    if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
      throw new Error("Simulator host process shutdown timeout is invalid");
    }
    authoritativeRuntimeProfile(environment, telemetry);
    const runtime = await startRuntime({ environment });
    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> =>
      (closePromise ??= (async () => {
        const results = await Promise.allSettled([
          runProcessCleanupWithinDeadline(async () => await runtime.close(), shutdownTimeoutMs),
          runProcessCleanupWithinDeadline(
            async () => await telemetry.shutdown(),
            shutdownTimeoutMs,
          ),
        ]);
        if (results.some(({ status }) => status === "rejected")) {
          reportFailure(telemetry, "shutdown");
          throw new Error("Simulator host shutdown failed");
        }
      })());
    closeProcess = close;
    const requestStop = (): void => {
      void close().catch(() => setExitCode(1));
    };
    signals.once("SIGINT", requestStop);
    signals.once("SIGTERM", requestStop);
    return Object.freeze({ close });
  } catch {
    reportFailure(telemetry, "startup");
    if (closeProcess === undefined) {
      try {
        await runProcessCleanupWithinDeadline(
          async () => await telemetry.shutdown(),
          shutdownTimeoutMs,
        );
      } catch {
        reportFailure(telemetry, "shutdown");
      }
    } else {
      try {
        await closeProcess();
      } catch {
        // The owned close path already reports shutdown failure without sensitive details.
      }
    }
    throw new Error("Simulator host startup failed");
  }
}
