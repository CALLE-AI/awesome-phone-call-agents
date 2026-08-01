import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createAppServer } from "../src/server.js";

async function withServer(
  createServer: () => ReturnType<typeof createAppServer>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "drill-static-"));
  const priorDataDir = process.env.DRILL_SIGNAL_DATA_DIR;
  process.env.DRILL_SIGNAL_DATA_DIR = dir;
  const server = createServer();
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
    if (priorDataDir === undefined) delete process.env.DRILL_SIGNAL_DATA_DIR;
    else process.env.DRILL_SIGNAL_DATA_DIR = priorDataDir;
  }
}

test("dev layout serves /, favicon, and styles from project public/", async () => {
  await withServer(createAppServer, async (baseUrl) => {
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    assert.match(await indexRes.text(), /DrillSignal/);

    const faviconRes = await fetch(`${baseUrl}/favicon.svg`);
    assert.equal(faviconRes.status, 200);
    assert.match(faviconRes.headers.get("content-type") ?? "", /svg/i);

    const stylesRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(stylesRes.status, 200);
    assert.match(stylesRes.headers.get("content-type") ?? "", /css/i);
  });
});

test("static path traversal guard still rejects parent escape", async () => {
  await withServer(createAppServer, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.equal(response.status, 404);
  });
});