// File: src/app/api/quotes/[id]/__tests__/auth.test.ts
// Reviewer fix 1: private reads (quote detail + event stream) require a caller token in
// live mode; the public mock demo stays open.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getQuote } from "../route";
import { GET as getEvents } from "../events/route";

function req(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost:3000/api/quotes/rfq_72148_zzzzzzzz", { headers });
}
const ctx = { params: Promise.resolve({ id: "rfq_72148_zzzzzzzz" }) };

describe("private reads — caller authorization (reviewer fix 1)", () => {
  afterEach(() => {
    delete process.env.GOODFAITH_LIVE;
    delete process.env.CALLE_API_KEY;
    delete process.env.GOODFAITH_API_TOKEN;
  });

  describe("mock mode stays open (public demo)", () => {
    beforeEach(() => {
      delete process.env.GOODFAITH_LIVE;
      delete process.env.CALLE_API_KEY;
    });
    it("serves the mock quote with no token", async () => {
      const res = await getQuote(req(), { params: ctx.params });
      expect(res.status).toBe(200);
    });
    it("serves the mock events with no token", async () => {
      const res = await getEvents(req(), { params: ctx.params });
      expect(res.status).toBe(200);
    });
  });

  describe("live mode requires a token", () => {
    beforeEach(() => {
      process.env.GOODFAITH_LIVE = "1";
      process.env.CALLE_API_KEY = "iams_test_key";
      process.env.GOODFAITH_API_TOKEN = "gf_live_token_123";
    });
    it("rejects the quote read with no token (401)", async () => {
      const res = await getQuote(req(), { params: ctx.params });
      expect(res.status).toBe(401);
    });
    it("rejects the events read with a wrong token (401)", async () => {
      const res = await getEvents(req("wrong"), { params: ctx.params });
      expect(res.status).toBe(401);
    });
    it("fails closed with 401 when no server token is configured", async () => {
      delete process.env.GOODFAITH_API_TOKEN;
      const res = await getQuote(req("anything"), { params: ctx.params });
      expect(res.status).toBe(401);
    });
  });
});
