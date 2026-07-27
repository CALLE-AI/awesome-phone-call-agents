/**
 * Server-boundary tests. These need a real server because the things they check are properties of
 * the HTTP surface, not of the run loop: what a request must look like before it can dial anyone,
 * and what leaves the process in the response body.
 *
 * Runs with no credentials and places no calls: the server is started in CALLE_MODE=simulate,
 * which drives the whole loop against the fake transport.
 *
 *   node --test test/server.test.mjs
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scenario = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/scenario.sample.json", import.meta.url)), "utf8"),
);
const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const PORT = 8912;
const BASE = `http://127.0.0.1:${PORT}`;

let child;

before(async () => {
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), CALLE_MODE: "simulate", CALLE_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Wait for the listen line rather than sleeping a guessed interval.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start in time")), 10_000);
    child.stdout.on("data", (b) => {
      if (b.toString().includes("workbench")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (c) => reject(new Error(`server exited early with code ${c}`)));
  });
});

after(() => child?.kill());

/** Read an SSE stream off a POST response and return every parsed event. */
async function collect(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      }
    }
  }
  return events;
}

const startRun = (body, headers = {}) =>
  fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("/api/run refuses GET: starting calls is not a safe method", async () => {
  const res = await fetch(`${BASE}/api/run?mode=live&confirmSlotId=${scenario.slot.id}`);
  assert.equal(res.status, 405);
  // A browser prefetch or an <img> pointing here must achieve nothing at all.
  assert.ok(!(res.headers.get("content-type") ?? "").includes("event-stream"));
});

test("/api/run refuses a cross-origin POST", async () => {
  const res = await startRun({ mode: "live", confirmSlotId: scenario.slot.id },
    { origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("/api/run refuses a cross-site fetch even without an Origin header", async () => {
  const res = await startRun({ mode: "preview" }, { "sec-fetch-site": "cross-site" });
  assert.equal(res.status, 403);
});

test("/api/run refuses a form-style content type, which is what a silent CSRF post would use", async () => {
  const res = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "mode=live",
  });
  assert.equal(res.status, 415);
});

test("/api/cancel is equally protected", async () => {
  assert.equal((await fetch(`${BASE}/api/cancel`)).status, 405);
  const cross = await fetch(`${BASE}/api/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(cross.status, 403);
});

test("/api/scenario never sends a raw waitlist number to the browser", async () => {
  const res = await fetch(`${BASE}/api/scenario`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const c of scenario.waitlist) {
    assert.ok(!body.includes(c.phone), `raw number for ${c.id} was sent to the client`);
  }
  const parsed = JSON.parse(body);
  assert.ok(parsed.waitlist.every((c) => c.phone === undefined), "no phone field may survive");
  assert.ok(parsed.waitlist.every((c) => typeof c.phoneMasked === "string"));
});

test("a simulated run is deterministic whatever the wall clock says", async () => {
  // THE POINT OF THIS TEST. Simulation asks for mode "live" on purpose, to exercise the intent
  // gate and the real loop. When the server took the real clock for that, every contact fell
  // outside the sample calling window and the scripted acceptance never happened - so the run the
  // README promises only worked if you happened to open the app at the right time of day.
  const res = await startRun({ mode: "live", confirmSlotId: scenario.slot.id });
  assert.equal(res.status, 200);
  const events = await collect(res);

  const filled = events.find((e) => e.type === "slot_filled");
  assert.ok(filled, "the scripted acceptance must happen regardless of the time of day");
  assert.equal(filled.contactId, "c_oyelaran");

  const suppressed = events.filter((e) => e.type === "contact_suppressed");
  assert.deepEqual(suppressed.map((e) => e.contactId), ["c_raman"],
    "the person behind the acceptance is never called");

  const finished = events.find((e) => e.type === "run_finished");
  assert.equal(finished.summary.filled, true);
  assert.equal(finished.summary.callsPlaced, 2);

  // And the transport is still fake, so nothing was dialled.
  assert.equal(events[0].transport, "fake");
});
