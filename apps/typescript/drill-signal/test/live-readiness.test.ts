import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, test } from "node:test";
import { createAppServer } from "../src/server.js";

const MANAGED_ENV_KEYS = [
  "DRILL_SIGNAL_DATA_DIR",
  "DRILL_SIGNAL_BIND_HOST",
  "DRILL_SIGNAL_OPERATOR_TOKEN",
  "CALLE_BASE_URL",
  "CALLE_API_KEY",
  "DRILL_SIGNAL_EMBEDDED_FAKE",
] as const;

function drillRecordCount(dataDir: string): number {
  return readdirSync(dataDir).filter((name) => name.endsWith(".json")).length;
}

async function withServer(env: Record<string, string | undefined>, fn: (baseUrl: string, dataDir: string) => Promise<void>) {
  const keysToRestore = new Set<string>([...MANAGED_ENV_KEYS, ...Object.keys(env)]);
  const prior: Record<string, string | undefined> = {};
  for (const key of keysToRestore) {
    prior[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "drill-live-ready-"));
  process.env.DRILL_SIGNAL_DATA_DIR = dir;
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3847;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl, dir);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(dir, { recursive: true, force: true });
    for (const key of keysToRestore) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const liveCreateBody = {
  primaryLabel: "Primary",
  primaryPhone: "+15550100001",
  primaryConsented: true,
  mode: "live",
};

describe("live readiness", { concurrency: 1 }, () => {
  test("GET /api/config reports liveReady false when CALLE_API_KEY is unset", async () => {
    await withServer({ CALLE_API_KEY: undefined }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/config`);
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { liveReady: boolean };
      assert.equal(payload.liveReady, false);
      assert.equal("CALLE_API_KEY" in payload, false);
    });
  });

  test("GET /api/config reports liveReady true when CALLE_API_KEY is configured", async () => {
    await withServer({ CALLE_API_KEY: "server-test-key" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/config`);
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { liveReady: boolean };
      assert.equal(payload.liveReady, true);
      assert.equal(JSON.stringify(payload).includes("server-test-key"), false);
    });
  });

  test("POST /api/drills live mode is rejected without CALLE_API_KEY and no drill is persisted", async () => {
    await withServer({ CALLE_API_KEY: undefined }, async (baseUrl, dataDir) => {
      const before = drillRecordCount(dataDir);
      const response = await fetch(`${baseUrl}/api/drills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveCreateBody),
      });
      assert.equal(response.status, 400);
      const payload = (await response.json()) as { error: string };
      assert.match(payload.error, /CALLE_API_KEY/i);
      assert.match(payload.error, /restart/i);
      assert.equal(drillRecordCount(dataDir), before);
    });
  });

  test("POST /api/drills live mode is accepted when CALLE_API_KEY is configured", async () => {
    await withServer({ CALLE_API_KEY: "server-test-key" }, async (baseUrl, dataDir) => {
      const response = await fetch(`${baseUrl}/api/drills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveCreateBody),
      });
      assert.equal(response.status, 201);
      const payload = (await response.json()) as { mode: string };
      assert.equal(payload.mode, "live");
      assert.equal(drillRecordCount(dataDir), 1);
    });
  });

  test("POST /api/drills simulation mode is unaffected when CALLE_API_KEY is unset", async () => {
    await withServer({ CALLE_API_KEY: undefined }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/drills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryLabel: "Primary",
          primaryPhone: "+15550100001",
          primaryConsented: true,
          mode: "simulation",
        }),
      });
      assert.equal(response.status, 201);
      const payload = (await response.json()) as { mode: string };
      assert.equal(payload.mode, "simulation");
    });
  });
});
