import assert from "node:assert/strict";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Server } from "node:http";

import { parseDemoPort, startDemoServer } from "../src/demo-server.js";

describe("interactive demo server", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolveClose, reject) => server?.close((error) => error ? reject(error) : resolveClose()));
      server = undefined;
    }
  });

  it("serves the interactive dashboard and JSON proof on localhost", async () => {
    const demo = await startDemoServer(resolve("."), 0);
    server = demo.server;

    const [page, summary] = await Promise.all([fetch(demo.url), fetch(`${demo.url}/summary.json`)]);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /id="run-test">Run safety check/);
    assert.equal(summary.status, 200);
    assert.equal((await summary.json() as { allExpectedOutcomesVerified: boolean }).allExpectedOutcomesVerified, true);
  });

  it("parses a safe explicit port", () => {
    assert.equal(parseDemoPort([]), 4173);
    assert.equal(parseDemoPort(["--port", "8080"]), 8080);
    assert.throws(() => parseDemoPort(["--port", "0"]), /1 to 65535/);
    assert.throws(() => parseDemoPort(["--unknown", "8080"]), /usage/i);
  });
});
