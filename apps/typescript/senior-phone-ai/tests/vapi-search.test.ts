import test from "node:test";
import assert from "node:assert/strict";
import { createVapiSearchHandler } from "../lib/vapi/search-handler";
import { createWebSearchResult } from "../lib/tools/search-web";

const secret = "test-only-secret-not-a-live-key-123456789";
const config = { enabled: true, secret, assistantId: "assistant-test" };
function request(query = "Latest Australian news", token = secret, assistant = "assistant-test", call = "call-1") {
  return new Request("http://localhost/api/vapi/search", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ message: {
    type: "tool-calls", assistant: { id: assistant }, call: { id: call },
    toolCallList: [{ id: "tool-1", name: "web_search", arguments: { query, location: "Melbourne, Australia" } }],
  } }) });
}
test("Vapi denies disabled, unauthenticated and wrong-assistant requests before search", async () => {
  let calls = 0;
  const search = async () => { calls++; throw new Error("must not run"); };
  const handler = createVapiSearchHandler(search, () => config);
  assert.equal((await handler(request(undefined, "wrong"))).status, 401);
  assert.equal((await handler(request(undefined, secret, "another"))).status, 403);
  assert.equal((await createVapiSearchHandler(search, () => ({ ...config, enabled: false }))(request())).status, 503);
  assert.equal(calls, 0);
});
test("Vapi returns correlated search results and coalesces concurrent retries", async () => {
  let calls = 0;
  const handler = createVapiSearchHandler(async (query, correlationId) => {
    calls++; assert.match(query, /Melbourne, Australia/);
    return createWebSearchResult({ query, correlationId, answer: "Verified current headline", sources: [{ title: "Source", url: "https://example.org/news" }] });
  }, () => config);
  const responses = await Promise.all([handler(request()), handler(request())]);
  const first = await responses[0].json();
  assert.deepEqual(first, await responses[1].json());
  assert.equal(first.results[0].toolCallId, "tool-1");
  assert.equal(JSON.parse(first.results[0].result).status, "completed");
  const conflict = await (await handler(request("Changed question"))).json();
  assert.equal(JSON.parse(conflict.results[0].result).status, "unavailable");
  assert.equal(calls, 1);
});
test("Vapi failures and missing sources become spoken fallback without exposing errors", async () => {
  for (const failure of [true, false]) {
    const handler = createVapiSearchHandler(async (query, correlationId) => {
      if (failure) throw new Error("private-api-key");
      return createWebSearchResult({ query, correlationId, answer: "Unsupported answer", sources: [] });
    }, () => config);
    const text = await (await handler(request())).text();
    assert.match(text, /unavailable/); assert.doesNotMatch(text, /private-api-key|Unsupported answer/);
  }
});
test("Vapi bounds payloads, validates tools and limits billable searches", async () => {
  let calls = 0;
  const handler = createVapiSearchHandler(async () => { calls++; throw new Error("offline"); }, () => config);
  assert.equal((await handler(new Request("http://localhost", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: "x".repeat(65_537) }))).status, 413);
  assert.equal((await handler(request("x"))).status, 400);
  for (let i = 0; i < 13; i++) await handler(request(undefined, secret, undefined, `call-${i}`));
  assert.equal(calls, 12);
});
