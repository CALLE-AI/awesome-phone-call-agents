import { test, expect } from "bun:test";
import { canPlaceAnotherCall, isAuthorized, maxCalls, DEFAULT_MAX_CALLS } from "../src/authz";

test("only allowlisted, valid numbers are authorized", () => {
  process.env.ALLOWED_PHONES = "+14155550101, +14155550102";
  expect(isAuthorized("+14155550101")).toBe(true);
  expect(isAuthorized("+14155550102")).toBe(true);
  expect(isAuthorized("+14155550199")).toBe(false); // not on the list
  expect(isAuthorized("+1555")).toBe(false); // invalid E.164
});

test("empty allowlist authorizes nothing", () => {
  process.env.ALLOWED_PHONES = "";
  expect(isAuthorized("+14155550101")).toBe(false);
});

test("unset allowlist authorizes nothing", () => {
  delete process.env.ALLOWED_PHONES;
  expect(isAuthorized("+14155550101")).toBe(false);
});

test("MAX_CALLS defaults to 4 when unset or blank", () => {
  delete process.env.MAX_CALLS;
  expect(maxCalls()).toBe(DEFAULT_MAX_CALLS);
  expect(maxCalls()).toBe(4);
  process.env.MAX_CALLS = "   ";
  expect(maxCalls()).toBe(4);
});

test("MAX_CALLS honors a valid positive integer", () => {
  process.env.MAX_CALLS = "2";
  expect(maxCalls()).toBe(2);
  process.env.MAX_CALLS = "10";
  expect(maxCalls()).toBe(10);
});

test("a malformed cap falls back to the default, never to unlimited", () => {
  for (const bad of ["0", "-3", "abc", "2.5", "Infinity", "1e3x"]) {
    process.env.MAX_CALLS = bad;
    expect(maxCalls()).toBe(DEFAULT_MAX_CALLS);
  }
  delete process.env.MAX_CALLS;
});

test("the booking path cannot exceed the same per-run cap", () => {
  expect(canPlaceAnotherCall(3, 4)).toBe(true);
  expect(canPlaceAnotherCall(4, 4)).toBe(false);
  expect(canPlaceAnotherCall(5, 4)).toBe(false);
});
