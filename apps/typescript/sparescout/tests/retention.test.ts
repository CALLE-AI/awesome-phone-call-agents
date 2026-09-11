import assert from "node:assert/strict";
import test from "node:test";
import { SOURCING_RETENTION_DAYS, sourcingRetentionCutoff } from "../lib/retention.ts";

test("uses an exact thirty-day sourcing retention cutoff", () => {
  assert.equal(SOURCING_RETENTION_DAYS, 30);
  assert.equal(
    sourcingRetentionCutoff(new Date("2026-08-17T12:00:00.000Z")),
    "2026-07-18T12:00:00.000Z",
  );
});
