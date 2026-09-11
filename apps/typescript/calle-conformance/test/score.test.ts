/**
 * The scorer prints a number, and a number is the easiest thing in this
 * repository to misread. A run the server cut short has seen fewer behaviours
 * than a complete one, so printing its tally as a score would say that the
 * server failed to reproduce what it was never asked to reproduce.
 *
 * That is the mistake the corpus exists to name, committed by the tool that
 * names it, which is why it is a test rather than a paragraph.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const started: ChildProcess[] = [];
after(() => {
  for (const child of started) child.kill();
});

let next = 41600 + Math.floor(Math.random() * 300);

async function serve(...args: string[]): Promise<{ base: string; port: number }> {
  const port = (next += 1);
  const child = spawn(process.execPath, ["src/fake.ts", "--port", String(port), ...args], {
    stdio: "ignore",
  });
  started.push(child);

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${base}/v1/calls/none`, { headers: { authorization: "Bearer probe" } });
      return { base, port };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`the fake never accepted a connection on ${port}`);
}

function score(base: string, ...args: string[]): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/score.ts", "--base", base, ...args]);
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", (code) => resolve({ code: code ?? -1, text }));
  });
}

describe("scoring a server", () => {
  test("a server that serves the corpus reproduces all of it", async () => {
    const { base } = await serve("--limit", "200");
    const { code, text } = await score(base, "--calls", "14");

    assert.equal(code, 0, text);
    assert.match(text, /8 of 8 reproduced/);
    assert.doesNotMatch(text, /absent/);
  });

  test("a run the server cut short is reported as incomplete, not as a score", async () => {
    // One unit, so the second create meets the cap and the run stops there.
    const { base } = await serve("--limit", "1");
    const { code, text } = await score(base, "--calls", "14");

    assert.equal(code, 2, "an incomplete run exited as though it were a verdict");
    assert.match(text, /incomplete, so it is not a score/);
    assert.match(text, /rate_limit_exceeded/);
    assert.doesNotMatch(text, /reproduced\./, "a tally was printed for a run that never finished");
    assert.doesNotMatch(
      text,
      /never sees/,
      "behaviours that were never asked for were listed as things the server lacks",
    );
  });

  test("it refuses a real CALL-E origin without sending anything", async () => {
    const { code, text } = await score("https://api.heycall-e.com");

    assert.equal(code, 2);
    assert.match(text, /Nothing was sent/);
    assert.doesNotMatch(text, /reproduced/);
  });
});
