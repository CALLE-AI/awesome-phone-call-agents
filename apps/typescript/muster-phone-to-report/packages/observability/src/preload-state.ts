import type { TelemetryLifecycle } from "./telemetry.js";

export interface SimulatorHostProcessTelemetry extends TelemetryLifecycle {
  readonly runtimeProfile: "development" | "test" | "ci" | "production";
  reportProcessFailure(input: Readonly<{ phase: "startup" | "shutdown" }>): void;
}

const TELEMETRY_PRELOAD_SYMBOL = Symbol.for("@muster/observability/telemetry-lifecycle");

function isTelemetryLifecycle(value: unknown): value is TelemetryLifecycle {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "start") === "function" &&
    typeof Reflect.get(value, "shutdown") === "function"
  );
}

export function publishPreloadedTelemetry(telemetry: TelemetryLifecycle): void {
  const existing = Reflect.get(globalThis, TELEMETRY_PRELOAD_SYMBOL) as unknown;
  if (existing !== undefined && existing !== telemetry) {
    throw new Error("Observability preload is already registered");
  }
  Reflect.set(globalThis, TELEMETRY_PRELOAD_SYMBOL, telemetry);
}

export function getPreloadedTelemetry(): TelemetryLifecycle {
  const telemetry = Reflect.get(globalThis, TELEMETRY_PRELOAD_SYMBOL) as unknown;
  if (!isTelemetryLifecycle(telemetry)) {
    throw new Error("Observability preload is required before runtime import");
  }
  return telemetry;
}

export function getPreloadedSimulatorHostTelemetry(): SimulatorHostProcessTelemetry {
  const telemetry = getPreloadedTelemetry();
  if (
    !("runtimeProfile" in telemetry) ||
    typeof telemetry.runtimeProfile !== "string" ||
    !("reportProcessFailure" in telemetry) ||
    typeof telemetry.reportProcessFailure !== "function"
  ) {
    throw new Error("Simulator host telemetry preload is invalid");
  }
  return telemetry as SimulatorHostProcessTelemetry;
}

export function clearPreloadedTelemetryForTest(): void {
  Reflect.deleteProperty(globalThis, TELEMETRY_PRELOAD_SYMBOL);
}
