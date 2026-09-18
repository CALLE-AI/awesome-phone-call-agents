import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertAuthorizedTarget, parseAuthorizedTargets } from "../src/authorized-targets.js";

describe("authorized-target allowlist", () => {
  it("parses, trims, and deduplicates exact E.164 targets", () => {
    const targets = parseAuthorizedTargets("+15550101234, +15550105678,+15550101234");

    assert.deepEqual([...targets], ["+15550101234", "+15550105678"]);
  });

  it("rejects missing or empty allowlists", () => {
    assert.throws(() => parseAuthorizedTargets(undefined), /missing or empty/i);
    assert.throws(() => parseAuthorizedTargets(" , "), /at least one/i);
  });

  it("rejects wildcards, prefixes, ranges, and malformed entries", () => {
    for (const value of ["+1555*", "+1555", "+15550101234-+15550105678", "15550101234", "+01234567890"]) {
      assert.throws(
        () => parseAuthorizedTargets(value),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /exact E\.164|invalid/i);
          assert.doesNotMatch(error.message, new RegExp(value.replaceAll(/[+*]/g, "\\$&")));
          return true;
        },
      );
    }
  });

  it("permits only exact allowlist matches", () => {
    const targets = parseAuthorizedTargets("+15550101234");

    assert.doesNotThrow(() => assertAuthorizedTarget("+15550101234", targets));
    assert.throws(
      () => assertAuthorizedTarget("+15550105678", targets),
      /not present.*No call was placed/i,
    );
  });
});
