import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requireApiKey } from "../src/middleware/auth.js";
import { env } from "../src/config/env.js";

function fakeRequest(authorization?: string): Request {
  return { header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as unknown as Request;
}

function fakeResponse(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = ((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as Response["status"];
  res.json = ((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as Response["json"];
  return res as Response & { statusCode?: number; body?: unknown };
}

test("requireApiKey rejects a request with no Authorization header", () => {
  const response = fakeResponse();
  let nextCalled = false;
  requireApiKey(fakeRequest(undefined), response, () => (nextCalled = true));
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireApiKey rejects a request with the wrong key", () => {
  const response = fakeResponse();
  let nextCalled = false;
  requireApiKey(fakeRequest("Bearer not-the-right-key"), response, () => (nextCalled = true));
  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireApiKey calls next() for the correct key", () => {
  const response = fakeResponse();
  let nextCalled = false;
  requireApiKey(fakeRequest(`Bearer ${env.ADMIN_API_KEY}`), response, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, undefined);
});
