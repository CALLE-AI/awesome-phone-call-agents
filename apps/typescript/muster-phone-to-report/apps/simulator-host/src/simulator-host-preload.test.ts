import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function runNode(
  repositoryRoot: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => (stdout += value));
    child.stderr.setEncoding("utf8").on("data", (value: string) => (stderr += value));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("simulator-host built process", () => {
  it("uses a dedicated telemetry preload that can import the built public runtime", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "apps/simulator-host/package.json"), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    expect(manifest.scripts?.["start"]).toBe(
      "node --import @muster/observability/register-simulator-host dist/main.js",
    );

    const build = await runNode(
      repositoryRoot,
      [
        path.join(repositoryRoot, "node_modules/typescript/bin/tsc"),
        "-b",
        "packages/observability",
        "apps/simulator-host",
        "--pretty",
        "false",
      ],
      {},
    );
    expect(build).toMatchObject({ code: 0, stderr: "" });

    const smoke = await runNode(
      path.join(repositoryRoot, "apps/simulator-host"),
      [
        "--import",
        "@muster/observability/register-simulator-host",
        "--input-type=module",
        "--eval",
        'const host = await import("./dist/index.js"); if (typeof host.startSimulatorHostRuntime !== "function") process.exitCode = 2; else process.stdout.write("simulator-host-ready");',
      ],
      {
        RUNTIME_PROFILE: "test",
        OTEL_SERVICE_NAME: "muster-simulator-host",
        OTEL_SERVICE_VERSION: "test",
        OTEL_TRACES_EXPORTER: "none",
        OTEL_TRACES_SAMPLER: "always_off",
        METRICS_ENABLED: "false",
        OTEL_METRICS_EXPORTER: "none",
      },
    );
    expect(smoke).toMatchObject({ code: 0, stdout: "simulator-host-ready", stderr: "" });
  });
});
