import { parseObservabilityConfig } from "./observability-config.js";
import { publishPreloadedTelemetry } from "./preload-state.js";
import { createTelemetryLifecycle } from "./telemetry.js";

const runtime = process.env["MUSTER_RUNTIME"];
if (runtime !== "api" && runtime !== "worker") {
  throw new Error("Invalid observability configuration: MUSTER_RUNTIME");
}

const telemetry = createTelemetryLifecycle(parseObservabilityConfig(process.env, runtime));
telemetry.start();
publishPreloadedTelemetry(telemetry);

export { telemetry };
