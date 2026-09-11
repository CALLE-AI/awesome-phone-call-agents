import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildPayload,
  buildTask,
  officialCalleBaseUrl,
  parseLiveRecipients,
  recipientResultSchema,
  requireOfficialCalleBaseUrl,
} from "../src/workflow.mjs";

const execute = promisify(execFile);

test("call task states disclosure and commercial limits", () => {
  const task = buildTask();
  assert.match(task, /Identify yourself as an AI/);
  assert.match(task, /Do not place an order/);
  assert.match(task, /Return unknown instead of guessing/);
});

test("payload preserves supplier ordering and human approval metadata", () => {
  const payload = buildPayload([
    { id: "supplier-1", phone: "+1555010100", region: "US", locale: "en-US" },
  ]);
  assert.deepEqual(payload.metadata.supplier_ids, ["supplier-1"]);
  assert.equal(payload.metadata.human_approval_required, true);
  assert.equal(recipientResultSchema.additionalProperties, false);
});

test("only the official CALL-E HTTPS origin is accepted", () => {
  assert.equal(requireOfficialCalleBaseUrl(), officialCalleBaseUrl);
  assert.equal(requireOfficialCalleBaseUrl(officialCalleBaseUrl), officialCalleBaseUrl);
  for (const candidate of [
    "https://example.com",
    "http://api.heycall-e.com",
    "https://api.heycall-e.com.example.com",
    "https://user:password@api.heycall-e.com",
    "https://api.heycall-e.com:8443",
    "https://api.heycall-e.com/v1",
    "https://api.heycall-e.com?target=other",
    "https://api.heycall-e.com#other",
  ]) {
    assert.throws(() => requireOfficialCalleBaseUrl(candidate), /official CALL-E HTTPS origin/);
  }
});

test("non-official origin is rejected before a provider request", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(500).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await assert.rejects(
    execute(process.execPath, ["src/index.mjs", "--live"], {
      cwd: new URL("..", import.meta.url),
      timeout: 5_000,
      env: {
        ...process.env,
        CALLE_BASE_URL: `http://127.0.0.1:${address.port}`,
        CALLE_API_KEY: "fixture-key",
        CAPACITYLINE_CONFIRM_LIVE: "YES",
        CAPACITYLINE_RECIPIENTS_JSON: JSON.stringify([
          { id: "supplier-1", phone: "+1555010100", region: "US", locale: "en-US" },
        ]),
      },
    }),
    /official CALL-E HTTPS origin/,
  );
  assert.equal(requests, 0);
});

test("duplicate destination phones are rejected even for different supplier ids", () => {
  assert.throws(() => parseLiveRecipients(JSON.stringify([
    { id: "supplier-1", phone: "+1555010100", region: "US", locale: "en-US" },
    { id: "supplier-2", phone: "+1555010100", region: "US", locale: "en-US" },
  ])), /Duplicate destination phone numbers/);
});

test("distinct valid recipients continue to pass", () => {
  const recipients = parseLiveRecipients(JSON.stringify([
    { id: "supplier-1", phone: "+1555010100", region: "US", locale: "en-US" },
    { id: "supplier-2", phone: "+1555010101", region: "US", locale: "en-US" },
  ]));
  assert.equal(recipients.length, 2);
});

test("default demo remains a no-call dry run", async () => {
  const { stdout } = await execute(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    timeout: 5_000,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.sideEffect, "none");
});
