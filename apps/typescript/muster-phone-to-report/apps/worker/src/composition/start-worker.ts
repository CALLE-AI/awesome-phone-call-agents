import { getPreloadedTelemetry } from "@muster/observability";

export async function startWorker(): Promise<void> {
  const telemetry = getPreloadedTelemetry();
  const { createWorkerProcess } = await import("./create-worker-process.js");
  const runtime = createWorkerProcess(process.env, telemetry);
  await runtime.start();

  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
  }

  const requestStop = () => {
    void stop().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
}
