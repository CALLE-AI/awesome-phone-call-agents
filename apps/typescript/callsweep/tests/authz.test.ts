import { test, expect } from "bun:test";
import { isAuthorized } from "../src/authz";

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
