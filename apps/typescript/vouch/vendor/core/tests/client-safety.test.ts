import assert from "node:assert/strict";
import { test } from "vitest";
import { createCalleClient, resolveCalleBaseUrl } from "../src/client";

test("real credentials are limited to the official HTTPS origin", () => {
  for (const base of ["http://api.heycall-e.com", "https://other.example", "https://api.heycall-e.com:444", "https://user:password@api.heycall-e.com", "https://api.heycall-e.com/extra"]) {
    assert.throws(() => createCalleClient({ apiKey: "test-only", baseUrl: base }, { CALLE_LIVE: "1" }));
  }
  assert.equal(resolveCalleBaseUrl({ CALLE_LIVE: "1" }), "https://api.heycall-e.com");
  assert.throws(() => createCalleClient({}, { CALLE_LIVE: "1" }));
});

test("simulator ignores ambient and explicit application keys and rejects redirects", async () => {
  const previous = globalThis.fetch;
  const seen: { headers: Headers; redirect: RequestRedirect | undefined }[] = [];
  globalThis.fetch = async (input, init) => {
    seen.push({ headers: new Headers(input instanceof Request ? input.headers : init?.headers), redirect: init?.redirect });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createCalleClient({ apiKey: "explicit-private-test" }, { CALLE_API_KEY: "ambient-private-test" });
    await client.calls.get("call_fake").catch(() => undefined);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.headers.get("Authorization"), "Bearer sim-local");
    assert.equal(seen[0]!.redirect, "error");
    assert.throws(() => createCalleClient({}, { CALLE_BASE_URL: "https://other.example" }));
  } finally {
    globalThis.fetch = previous;
  }
});
