/**
 * The fake is only worth running if it is wrong in the same places the platform
 * is wrong. A fake that serves the corpus but answers in the SDK's own
 * vocabulary, or that bills only the creates it accepts, is a fake written from
 * the documentation again, which is the thing this project exists to refuse.
 *
 * So these tests drive the server the way an application does, through the
 * published SDK, and assert the two properties that are easy to lose: the
 * payload arrives in the shape the wire uses, and a create the planner rejects
 * still costs a unit.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { CalleClient } from "@call-e/calle";
import { QUIRKS, type CallPayload } from "../src/quirks.ts";

const started: ChildProcess[] = [];
after(() => {
  for (const child of started) child.kill();
});

/** A port high enough that a developer machine is unlikely to be using it. */
let next = 41100 + Math.floor(Math.random() * 400);

async function serve(...args: string[]): Promise<string> {
  const port = (next += 1);
  const child = spawn(process.execPath, ["src/fake.ts", "--port", String(port), ...args], {
    stdio: "ignore",
  });
  started.push(child);

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`${base}/v1/calls/none`, { headers: { authorization: "Bearer probe" } });
      return base;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`the fake never accepted a connection on ${port}`);
}

const US = { phone: "+12025550142", region: "US", locale: "en-US" };
const TASK = "Ask whether they can hear the call clearly, thank them, and end the call.";

describe("the corpus, served", () => {
  test("a key is required, and the balance endpoints stay missing", async () => {
    const base = await serve();

    const noKey = await fetch(`${base}/v1/calls`, { method: "POST" });
    assert.equal(noKey.status, 401);

    for (const path of ["/v1/account", "/v1/balance", "/v1/credits", "/v1/usage", "/v1/me"]) {
      const res = await fetch(`${base}${path}`, { headers: { authorization: "Bearer k" } });
      assert.equal(res.status, 404, `${path} answered, and the platform does not`);
    }
  });

  test("the payload is on the wire in the shape the SDK maps from", async () => {
    const base = await serve();
    const created = await fetch(`${base}/v1/calls`, {
      method: "POST",
      headers: { authorization: "Bearer k", "content-type": "application/json" },
      body: JSON.stringify({ task: TASK, recipients: [US] }),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);

    assert.ok("created_at" in created, "created_at is missing, so the SDK would read undefined");
    assert.ok(!("createdAt" in created), "createdAt is on the wire, which the platform does not send");
    assert.ok("task_completed" in created);
    assert.ok(!("taskCompleted" in created));
  });

  test("every behaviour in the corpus survives the round trip through the SDK", async () => {
    const base = await serve("--limit", "400");
    const client = new CalleClient({ apiKey: "scored-fake", baseUrl: base });

    const seen = new Set<string>();
    for (let n = 0; n < 14; n += 1) {
      const created = await client.calls.create({ task: TASK, recipients: [US] });
      let call = created;
      for (let i = 0; i < 3; i += 1) call = await client.calls.get(created.id);
      for (const quirk of QUIRKS) {
        if (quirk.holds(call as unknown as CallPayload)) seen.add(quirk.id);
      }
    }

    assert.deepEqual(
      QUIRKS.map((q) => q.id).filter((id) => !seen.has(id)),
      [],
      "a behaviour the corpus carries did not reach a client through the wire",
    );
  });

  test("a create the planner rejects still spends a unit", async () => {
    // This is the finding the repository budgets against, so it has to be the
    // behaviour of the fake and not a paragraph in its README.
    const base = await serve("--limit", "3");
    const post = (region: string) =>
      fetch(`${base}/v1/calls`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, recipients: [{ ...US, region }] }),
      });

    for (let i = 0; i < 3; i += 1) {
      const rejected = await post("PE");
      assert.equal(rejected.status, 422, "an unsupported region was accepted");
    }

    const capped = await post("US");
    assert.equal(capped.status, 429, "three rejected creates left the counter untouched");
    const body = (await capped.json()) as { error: { code: string; details: Record<string, unknown> } };
    assert.equal(body.error.code, "rate_limit_exceeded");
    assert.equal(body.error.details.count, 3);
    assert.equal(body.error.details.limit, 3);
  });

  test("at the cap the limiter answers first, so reading the counter is free", async () => {
    const base = await serve("--limit", "1");
    const post = () =>
      fetch(`${base}/v1/calls`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({ task: TASK, recipients: [US] }),
      });

    assert.equal((await post()).status, 201);
    for (let i = 0; i < 3; i += 1) {
      const body = (await (await post()).json()) as { error: { details: { count: number } } };
      assert.equal(body.error.details.count, 1, "a capped probe moved the counter");
    }
  });

  test("--fixture pins one response and --quirk serves only its carriers", async () => {
    const base = await serve("--quirk", "raw-sip-code-as-failure-code", "--limit", "40");
    const client = new CalleClient({ apiKey: "scored-fake", baseUrl: base });

    for (let n = 0; n < 4; n += 1) {
      const created = await client.calls.create({ task: TASK, recipients: [US] });
      let call = created;
      for (let i = 0; i < 3; i += 1) call = await client.calls.get(created.id);
      const carries = QUIRKS.find((q) => q.id === "raw-sip-code-as-failure-code");
      assert.ok(carries?.holds(call as unknown as CallPayload), "a served response lacked the pinned behaviour");
    }
  });
});
