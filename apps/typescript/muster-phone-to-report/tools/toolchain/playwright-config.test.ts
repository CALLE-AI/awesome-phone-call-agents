import { describe, expect, it } from "vitest";

import { parseBrowserPort } from "./browser-port.js";

describe("Playwright browser port configuration", () => {
  it("defaults to 4173 and accepts an explicit decimal TCP port", () => {
    expect(parseBrowserPort(undefined)).toBe(4173);
    expect(parseBrowserPort("4174")).toBe(4174);
    expect(parseBrowserPort("65535")).toBe(65_535);
  });

  it.each(["", "0", "65536", "04173", " 4173", "4173 ", "4173; echo unsafe"])(
    "rejects unsafe or out-of-range value %j before shell interpolation",
    (value) => {
      expect(() => parseBrowserPort(value)).toThrowError(
        "MUSTER_BROWSER_PORT must be a decimal TCP port from 1 through 65535",
      );
    },
  );
});
