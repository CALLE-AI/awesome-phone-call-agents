import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startLiveDemoReviewRuntime,
  type LiveDemoReviewProjection,
} from "../composition/start-live-demo-review-runtime.js";
import { establishLiveDemoReviewLease } from "./live-demo-review-session.js";
import {
  createLiveSimulatorController,
  startSimulatorHostHttpRuntime,
} from "./live-simulator-http-runtime.js";

const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all(
    [...children].map(
      async (child) =>
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          child.kill();
        }),
    ),
  );
  children.clear();
});

async function unusedLoopbackPort(host = "127.0.0.1"): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Port allocation failed");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}

async function startVite(browserPort: number, browserOrigin: string, targetOrigin: string) {
  const webRoot = path.resolve(import.meta.dirname, "../../../web");
  const viteCli = path.join(webRoot, "node_modules/vite/bin/vite.js");
  let stderr = "";
  const child = spawn(
    process.execPath,
    [
      viteCli,
      "--mode",
      "demo",
      "--host",
      "127.0.0.1",
      "--port",
      String(browserPort),
      "--strictPort",
    ],
    {
      cwd: webRoot,
      env: {
        COMSPEC: process.env["COMSPEC"],
        PATH: process.env["PATH"],
        PATHEXT: process.env["PATHEXT"],
        SYSTEMDRIVE: process.env["SYSTEMDRIVE"],
        SYSTEMROOT: process.env["SYSTEMROOT"],
        TEMP: process.env["TEMP"],
        TMP: process.env["TMP"],
        WINDIR: process.env["WINDIR"],
        SIMULATOR_DEMO_ORIGIN: browserOrigin,
        SIMULATOR_HOST_PROXY_ORIGIN: targetOrigin,
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  children.add(child);
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_096);
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness: ${stderr}`);
    try {
      const response = await fetch(`${browserOrigin}/simulator.html`);
      if (response.status === 200) return child;
    } catch {
      // The bounded loop waits only for the local listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Vite readiness timed out: ${stderr}`);
}

describe("Vite live-demo loopback proxy", () => {
  it("carries exact-origin readiness GET, review GET, and review DELETE across the runtime transition", async () => {
    const [browserPort, backendPort] = await Promise.all([
      unusedLoopbackPort(),
      unusedLoopbackPort("::1"),
    ]);
    const browserOrigin = `http://127.0.0.1:${String(browserPort)}`;
    const backendOrigin = `http://[::1]:${String(backendPort)}`;
    const operationId = "operation-vite-proxy-001";
    const sessionId = "session-vite-proxy-001";
    const observeViewerReadiness = vi.fn();
    const liveRuntime = await startSimulatorHostHttpRuntime({
      host: "::1",
      port: backendPort,
      publicBaseUrl: "https://simulator.invalid",
      allowedDemoOrigin: browserOrigin,
      maxBodyBytes: 1_024,
      liveController: createLiveSimulatorController({
        runtimeProfile: "test",
        enabled: true,
        scenarios: [
          { scenarioId: "synthetic-normal", revision: 2, supportedModes: ["LIVE_SMOKE"] },
        ],
        requestLiveObservation: vi.fn(),
        getLiveObservation: vi.fn(async () => ({
          operationId,
          resourceVersion: 1,
          stage: "scheduled" as const,
          terminal: false,
          terminalOutcome: null,
          scenarioId: "synthetic-normal",
          scenarioRevision: 2,
          provenance: "SIMULATED" as const,
          transcript: [],
          evidence: null,
          readings: [],
          reconciliation: [],
          auxiliaryStatus: null,
          predecessorOperationId: null,
        })),
      }),
      twilioController: { voice: vi.fn(), canary: vi.fn(), status: vi.fn() },
      establishTraceContext: () => ({
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      }),
      observeViewerReadiness,
    });
    await startVite(browserPort, browserOrigin, backendOrigin);

    const operationPath = `/api/v1/live-simulator/operations/${operationId}`;
    const readiness = await fetch(`${browserOrigin}${operationPath}`);
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({ operationId });
    expect(observeViewerReadiness).toHaveBeenCalledOnce();
    await liveRuntime.close();

    const identity = Object.freeze({
      operationId,
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
    });
    const lease = establishLiveDemoReviewLease({
      identity,
      reviewReadyAt: "2099-09-02T12:00:00.000Z",
    });
    const readings = ["1", "2", "3", "4"].map((zone) => ({
      zoneId: `zone-${zone}`,
      label: `Zone ${zone}`,
      value: "70",
      unit: "F",
      status: "OK" as const,
      disposition: "grounded" as const,
    }));
    const projection: LiveDemoReviewProjection = {
      ...identity,
      resourceVersion: 2,
      stage: "terminal",
      terminal: true,
      terminalOutcome: "observation_recorded",
      provenance: "SIMULATED",
      transcript: [{ speaker: "device", text: "Synthetic greenhouse report." }],
      evidence: { quality: "complete" },
      readings,
      reconciliation: readings.map(({ zoneId }) => ({ zoneId, disposition: "matched" as const })),
      auxiliaryStatus: {
        sound: "normal",
        power: "mains_available",
        battery: "normal",
        output: "off",
      },
      predecessorOperationId: null,
    };
    const cleanup = vi.fn(async () => ({
      outcome: "deleted" as const,
      message: "Protected demo result deleted" as const,
    }));
    const reviewRuntime = await startLiveDemoReviewRuntime({
      host: "::1",
      port: backendPort,
      allowedBrowserOrigin: browserOrigin,
      sessionId,
      lease,
      now: () => new Date("2099-09-02T12:01:00.000Z"),
      readExactProjection: vi.fn(async () => projection),
      cleanup,
    });
    try {
      const review = await fetch(`${browserOrigin}${operationPath}`);
      expect(review.status).toBe(200);
      expect(review.headers.get("x-muster-review-capability")).toBe("closed");
      await expect(review.json()).resolves.toMatchObject(identity);

      const deletion = await fetch(
        `${browserOrigin}/api/v1/live-demo-review/sessions/${sessionId}`,
        { method: "DELETE" },
      );
      expect(deletion.status).toBe(200);
      await expect(deletion.json()).resolves.toEqual({
        outcome: "deleted",
        message: "Protected demo result deleted",
      });
      expect(cleanup).toHaveBeenCalledWith("finish");
    } finally {
      await reviewRuntime.close();
    }
  });
});
