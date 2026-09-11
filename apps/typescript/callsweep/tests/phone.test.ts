import { test, expect } from "bun:test";
import { isE164, maskPhone } from "../src/phone";

test("isE164 accepts strict E.164 only", () => {
  expect(isE164("+14155550100")).toBe(true);
  expect(isE164("+447700900123")).toBe(true);
  expect(isE164("15550100000")).toBe(false); // no +
  expect(isE164("+1555")).toBe(false); // too short
  expect(isE164("+abc")).toBe(false); // not digits
  expect(isE164("+14155550101 x")).toBe(false); // trailing junk
});

test("maskPhone reveals only the last 4 digits", () => {
  expect(maskPhone("+14155550100")).toBe("+*******0100");
  expect(maskPhone("+14155550101")).toBe("+*******0101");
});
