import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";

async function withDistServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "drill-static-dist-"));
  const priorDataDir = process.env.DRILL_SIGNAL_DATA_DIR;
  process.env.DRILL_SIGNAL_DATA_DIR = dir;
  const { createAppServer } = await import("../dist/server.js");
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
      server.close((error: Error | undefined) => (error ? reject(error) : resolve()));
    });
    rmSync(dir, { recursive: true, force: true });
    if (priorDataDir === undefined) delete process.env.DRILL_SIGNAL_DATA_DIR;
    else process.env.DRILL_SIGNAL_DATA_DIR = priorDataDir;
  }
}

test("compiled production server serves /, favicon, and assets from dist/public/", async () => {
  await withDistServer(async (baseUrl) => {
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    assert.match(await indexRes.text(), /DrillSignal/);

    const faviconRes = await fetch(`${baseUrl}/favicon.svg`);
    assert.equal(faviconRes.status, 200);
    assert.match(faviconRes.headers.get("content-type") ?? "", /svg/i);

    const appJsRes = await fetch(`${baseUrl}/app.js`);
    assert.equal(appJsRes.status, 200);
    assert.match(appJsRes.headers.get("content-type") ?? "", /javascript/i);
  });
});

test("compiled production server rejects static path traversal", async () => {
  await withDistServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.equal(response.status, 404);
  });
});
