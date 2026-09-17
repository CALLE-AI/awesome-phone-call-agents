// The MCP server is hand-rolled JSON-RPC, so these tests speak the protocol to it directly and
// check the two things that matter: it answers correctly, and no tool it exposes can place a call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../src/mcp.js";

/** Captures what the server writes to stdout for one message. */
async function send(message: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const written: Record<string, unknown>[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    for (const line of s.split("\n").filter((l) => l.trim().length > 0)) {
      written.push(JSON.parse(line) as Record<string, unknown>);
    }
    return true;
  };
  try {
    await handle(message as never);
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  return written;
}

const textOf = (res: Record<string, unknown>): string =>
  ((res["result"] as { content?: { text?: string }[] })?.content?.[0]?.text) ?? "";

test("it initializes and advertises its tools", async () => {
  const init = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const info = (init[0]?.["result"] as { serverInfo?: { name?: string }; protocolVersion?: string });
  assert.equal(info.serverInfo?.name, "still-covered");
  assert.ok(typeof info.protocolVersion === "string");

  const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list[0]?.["result"] as { tools: { name: string; inputSchema: unknown }[] }).tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["lint_call_task", "list_call_task_rules", "plan_outreach", "run_conformance_probes"]);
  for (const t of tools) {
    assert.ok(t.inputSchema, `${t.name} declares an input schema`);
  }
});

test("no exposed tool can place a phone call", async () => {
  const list = await send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  const tools = (list[0]?.["result"] as { tools: { name: string; description: string }[] }).tools;
  // The two tools that shell out are pinned to --dry-run by the server, not by their arguments.
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8"));
  assert.match(source, /"--dry-run"/, "the CLI helper appends --dry-run");
  // --confirm appears once, in a comment explaining what an agent cannot reach. What must never
  // exist is code that puts it into an argument list.
  const executable = source.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
  assert.ok(!executable.some((l) => /--confirm/.test(l)), "no code path can satisfy the live-mode gate");
  assert.ok(!executable.some((l) => /SC_MODE/.test(l)), "and none can set live mode either");
  assert.equal(tools.length, 4);
});

test("lint_call_task reports on a task that defends nothing", async () => {
  const res = await send({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "lint_call_task", arguments: { task: "Call them and ask if they qualify." } },
  });
  const text = textOf(res[0] ?? {});
  assert.match(text, /boundaries defended/);
  assert.match(text, /ERROR/);
  assert.match(text, /identity-before-disclosure/);
  assert.match(text, /Learned from:/, "every finding cites the call that produced the rule");
});

test("an empty task is answered with guidance, not a crash", async () => {
  const res = await send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "lint_call_task", arguments: {} } });
  assert.match(textOf(res[0] ?? {}), /No task text supplied/);
});

test("an unknown tool is a protocol error, not a silent pass", async () => {
  const res = await send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "place_call", arguments: {} } });
  const error = res[0]?.["error"] as { code: number; message: string } | undefined;
  assert.equal(error?.code, -32602);
  assert.match(error?.message ?? "", /Unknown tool: place_call/);
});

test("notifications get no reply, and unknown methods do", async () => {
  assert.equal((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).length, 0);
  const res = await send({ jsonrpc: "2.0", id: 7, method: "resources/list" });
  assert.equal((res[0]?.["error"] as { code: number }).code, -32601);
});
