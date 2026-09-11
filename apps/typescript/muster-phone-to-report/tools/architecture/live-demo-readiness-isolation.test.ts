import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectLiveDemoReadinessIsolation } from "./live-demo-readiness-isolation.js";

describe("live demo readiness capability isolation", () => {
  it("keeps the verifier free of ambient environment, provider, and external-network capabilities", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    await expect(inspectLiveDemoReadinessIsolation({ repositoryRoot })).resolves.toEqual({
      violations: [],
    });

    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        sourceMutation: "const leaked = process.env;",
      }),
    ).resolves.toEqual({ violations: ["ambient environment access"] });
    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        sourceMutation: 'import "@muster/infrastructure-calle";',
      }),
    ).resolves.toEqual({ violations: ["provider capability import"] });
    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        sourceMutation: 'import { request } from "node:https";',
      }),
    ).resolves.toEqual({ violations: ["external networking capability"] });
  });

  it("allows only direct, non-credential recorder environment reads", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");

    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        recorderMutation: "const entries = Object.entries(process.env);",
      }),
    ).resolves.toMatchObject({ violations: ["ambient environment enumeration"] });
    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        recorderMutation: "const ambient = process.env;",
      }),
    ).resolves.toMatchObject({ violations: ["ambient environment enumeration"] });
    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        recorderMutation: 'const credential = process.env["TWILIO_AUTH_TOKEN"];',
      }),
    ).resolves.toMatchObject({
      violations: ["non-allowlisted ambient environment access"],
    });
    await expect(
      inspectLiveDemoReadinessIsolation({
        repositoryRoot,
        recorderMutation: 'const dockerHost = process.env["DOCKER_HOST"];',
      }),
    ).resolves.toMatchObject({
      violations: [
        "non-allowlisted ambient environment access",
        "unsafe Docker environment propagation",
      ],
    });
  });
});
