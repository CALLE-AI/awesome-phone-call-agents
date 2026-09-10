import { getPreloadedTelemetry } from "@muster/observability";

export async function startApi(): Promise<void> {
  const telemetry = getPreloadedTelemetry();
  try {
    const { createApiProcess } = await import("./create-api-process.js");
    const runtime = await createApiProcess(process.env, telemetry);
    let stopPromise: Promise<void> | undefined;
    const stop = () => (stopPromise ??= runtime.close());
    const requestStop = () => {
      void stop().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", requestStop);
    process.once("SIGTERM", requestStop);
  } catch (error: unknown) {
    await telemetry.shutdown().catch(() => undefined);
    throw error;
  }
}
