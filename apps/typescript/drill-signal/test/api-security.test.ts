import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  "DRILL_SIGNAL_EMBEDDED_FAKE",
] as const;

async function withServer(env: Record<string, string | undefined>, fn: (baseUrl: string) => Promise<void>) {
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
  const dir = mkdtempSync(join(tmpdir(), "drill-api-"));
  process.env.DRILL_SIGNAL_DATA_DIR = dir;
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3847;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
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

describe("api security", { concurrency: 1 }, () => {
  test("HTTP launch without safety preview is rejected", async () => {
    await withServer({}, async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/drills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryLabel: "Primary",
          primaryPhone: "+15550100001",
          primaryConsented: true,
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as { id: string };
      const launchRes = await fetch(`${baseUrl}/api/drills/${created.id}/launch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launchConfirmed: true }),
      });
      assert.equal(launchRes.status, 400);
      const payload = (await launchRes.json()) as { error: string };
      assert.match(payload.error, /armed|preview/i);
    });
  });

  test("non-loopback bind requires operator bearer token for mutating routes", async () => {
    await withServer(
      {
        DRILL_SIGNAL_BIND_HOST: "0.0.0.0",
        DRILL_SIGNAL_OPERATOR_TOKEN: "test-operator-token",
      },
      async (baseUrl) => {
        const denied = await fetch(`${baseUrl}/api/drills`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primaryLabel: "Primary",
            primaryPhone: "+15550100001",
            primaryConsented: true,
          }),
        });
        assert.equal(denied.status, 401);

        const allowed = await fetch(`${baseUrl}/api/drills`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer test-operator-token",
          },
          body: JSON.stringify({
            primaryLabel: "Primary",
            primaryPhone: "+15550100001",
            primaryConsented: true,
          }),
        });
        assert.equal(allowed.status, 201);
      },
    );
  });

  test("static path traversal is rejected", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);
      assert.equal(response.status, 404);
    });
  });

  test("fake-server missing configuration returns clear API error when embedded fake disabled", async () => {
    await withServer(
      {
        CALLE_BASE_URL: "http://127.0.0.1:0",
        DRILL_SIGNAL_EMBEDDED_FAKE: "0",
      },
      async (baseUrl) => {
        const createRes = await fetch(`${baseUrl}/api/drills`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primaryLabel: "Primary",
            primaryPhone: "+15550100001",
            primaryConsented: true,
            mode: "fake-server",
          }),
        });
        assert.equal(createRes.status, 201);
        const created = (await createRes.json()) as { id: string };
        const previewRes = await fetch(`${baseUrl}/api/drills/${created.id}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operatorConfirmedDrillPurpose: true,
            maxCallsDisclosed: true,
          }),
        });
        assert.equal(previewRes.status, 200);
        const launchRes = await fetch(`${baseUrl}/api/drills/${created.id}/launch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ launchConfirmed: true }),
        });
        assert.equal(launchRes.status, 400);
        const payload = (await launchRes.json()) as { error: string };
        assert.match(payload.error, /CALLE_BASE_URL|embedded fake/i);
      },
    );
  });

  test("isolated servers do not share drill records across data directories", async () => {
    let drillId = "";
    await withServer({}, async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/api/drills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryLabel: "Primary",
          primaryPhone: "+15550100001",
          primaryConsented: true,
        }),
      });
      assert.equal(createRes.status, 201);
      drillId = ((await createRes.json()) as { id: string }).id;
    });
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/drills/${drillId}`);
      assert.equal(response.status, 404);
    });
  });

  test("health endpoint reports auth requirement on non-loopback configuration", async () => {
    await withServer(
      {
        DRILL_SIGNAL_BIND_HOST: "0.0.0.0",
        DRILL_SIGNAL_OPERATOR_TOKEN: "token",
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`);
        const payload = await response.json();
        assert.equal(payload.authRequired, true);
      },
    );
  });

  test("health endpoint reports authRequired false on loopback bind", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      assert.equal(payload.authRequired, false);
      assert.equal(payload.ok, true);
    });
  });
});
