import { parseObservabilityConfig } from "./observability-config.js";
import { publishPreloadedTelemetry } from "./preload-state.js";
import { createSimulatorHostProcessTelemetry } from "./simulator-host.js";
import { createTelemetryLifecycle } from "./telemetry.js";

const configuration = parseObservabilityConfig(process.env, "simulator-host");
const telemetry = createSimulatorHostProcessTelemetry({
  runtimeProfile: configuration.profile,
  telemetry: createTelemetryLifecycle(configuration),
});
telemetry.start();
publishPreloadedTelemetry(telemetry);

export { telemetry };
