import assert from "node:assert/strict";
import test from "node:test";

import { requireVerifiedPrincipal, type ClaimsClient } from "../lib/db/auth";
import { readSupabasePublicConfig } from "../lib/db/config";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function claimsClient(claims?: Readonly<Record<string, unknown>>, error: unknown = null): ClaimsClient {
  return { auth: { getClaims: async () => ({ data: { claims }, error }) } };
}

test("public Supabase config accepts HTTPS and local development URLs", () => {
  assert.deepEqual(readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  }), {
    publishableKey: "sb_publishable_example",
    url: "https://example.supabase.co",
  });
  assert.equal(readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }).url, "http://127.0.0.1:54321");
});

test("public Supabase config rejects insecure remote and absent values", () => {
  assert.throws(() => readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://example.com",
  }), /HTTPS/);
  assert.throws(() => readSupabasePublicConfig({}), /not configured/);
});

test("verified principal comes from verified claims", async () => {
  assert.equal(await requireVerifiedPrincipal(claimsClient({ sub: USER_ID })), USER_ID);
});

test("missing, malformed and failed claims are denied", async () => {
  await assert.rejects(requireVerifiedPrincipal(claimsClient()), /verified Supabase session/);
  await assert.rejects(requireVerifiedPrincipal(claimsClient({ sub: "caller-id" })), /verified Supabase session/);
  await assert.rejects(requireVerifiedPrincipal(claimsClient({ sub: USER_ID }, new Error("invalid"))), /verified Supabase session/);
});
