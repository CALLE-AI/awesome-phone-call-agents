import { after, test } from "node:test";
import assert from "node:assert/strict";
import { calleClient } from "../lib/calle";
import { requireOperator } from "../lib/auth";
import { proxy } from "../proxy";
import { NextRequest } from "next/server";

const saved = { ...process.env };
after(() => {
  for (const key of ["CALLE_API_KEY", "CALLE_BASE_URL", "CLARITY_AUTH_TOKEN", "CLARITY_ORIGIN"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test("CALL-E credentials are pinned to the exact approved HTTPS origin", () => {
  process.env.CALLE_API_KEY = "test-key";
  for (const url of ["http://api.heycall-e.com", "https://evil.example", "https://api.heycall-e.com.evil.example", "https://api.heycall-e.com@evil.example", "https://user:pass@api.heycall-e.com", "https://api.heycall-e.com:444", "https://api.heycall-e.com/path", "https://api.heycall-e.com?next=evil", "https://api.heycall-e.com#fragment", " https://api.heycall-e.com"]) {
    process.env.CALLE_BASE_URL = url;
    assert.throws(() => calleClient(), /credentials require/);
  }
  for (const url of ["", "https://api.heycall-e.com", "https://api.heycall-e.com/"]) {
    process.env.CALLE_BASE_URL = url;
    assert.doesNotThrow(() => calleClient());
  }
});

test("proxy protects the page and transcript URLs, without a local-host exemption", () => {
  process.env.CLARITY_AUTH_TOKEN = "test-operator-credential-32-characters-long";
  for (const url of ["http://localhost/", "https://clarity.example/api/call/session", "https://clarity.example/?debug=1"]) {
    const response = proxy(new NextRequest(url));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("valid Basic authentication does not expose a provider credential to the browser", () => {
  const token = "test-operator-credential-32-characters-long";
  process.env.CLARITY_AUTH_TOKEN = token;
  assert.equal(requireOperator(new Request("https://clarity.example", { headers: { authorization: `Basic ${Buffer.from(`clarity:${token}`).toString("base64")}` } })), null);
});

test("same-origin consent survives internal server URLs without trusting forwarded hosts", () => {
  const token = "test-operator-credential-32-characters-long";
  process.env.CLARITY_AUTH_TOKEN = token;
  process.env.CLARITY_ORIGIN = "https://clarity.example";
  const headers = { authorization: `Basic ${Buffer.from(`clarity:${token}`).toString("base64")}`, origin: "https://clarity.example" };
  assert.equal(requireOperator(new Request("http://localhost:3000/api/call", { method: "POST", headers })), null);
  assert.equal(requireOperator(new Request("http://localhost:3000/api/call", { method: "POST", headers: { ...headers, origin: "https://attacker.example", "x-forwarded-host": "attacker.example" } }))?.status, 403);
});
