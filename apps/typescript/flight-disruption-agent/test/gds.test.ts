import assert from "node:assert/strict";
import { test } from "node:test";
import { findBooking, loadCatalog } from "../src/data.ts";
import { FakeGds } from "../src/gds.ts";

const catalog = loadCatalog();
const gds = new FakeGds();

test("the fake portal accepts ordinary changes", () => {
  assert.deepEqual(gds.submit(findBooking(catalog, "L6F2KM"), { kind: "move", optionId: "NA729-2026-09-20" }), { kind: "accepted" });
});

test("the fake portal rejects a reissue it is scripted to refuse, but still refunds", () => {
  const booking = findBooking(catalog, "P3X9GA");
  const result = gds.submit(booking, { kind: "move", optionId: "NA729-2026-09-20" });
  assert.equal(result.kind, "rejected");
  assert.equal(result.kind === "rejected" && result.code, "REISSUE_NOT_PERMITTED");
  assert.deepEqual(gds.submit(booking, { kind: "refund" }), { kind: "accepted" });
});

test("every airline in the rules has an E.164 service desk number", () => {
  for (const party of Object.values(catalog.rules.parties)) {
    if (party.role === "airline") assert.match(party.supportPhone, /^\+[1-9]\d{6,14}$/);
  }
});
