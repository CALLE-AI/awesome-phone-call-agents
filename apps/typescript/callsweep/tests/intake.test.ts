import { test, expect } from "bun:test";
import { parseBudget, stripBudget } from "../src/intake";

test("parseBudget reads a target price from the request", () => {
  expect(parseBudget("haircut under $40")).toBe(40);
  expect(parseBudget("cheapest haircut, less than 30")).toBe(30);
  expect(parseBudget("oil change for $25")).toBe(25);
  expect(parseBudget("budget 50 for a trim")).toBe(50);
});

test("parseBudget returns null when no price is stated", () => {
  expect(parseBudget("haircut in San Francisco")).toBeNull();
  expect(parseBudget("")).toBeNull();
});

test("stripBudget removes the price so the opening pitch never leaks it", () => {
  expect(stripBudget("haircut under 40")).toBe("haircut");
  expect(stripBudget("oil change for $60")).toBe("oil change");
  expect(stripBudget("cheapest haircut, less than 30")).toBe("cheapest haircut,");
  expect(stripBudget("haircut in San Francisco")).toBe("haircut in San Francisco");
});
