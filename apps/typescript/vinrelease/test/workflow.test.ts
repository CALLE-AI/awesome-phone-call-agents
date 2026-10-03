import assert from "node:assert/strict";
import test from "node:test";
import { applyResult, initialCase } from "../src/workflow.js";

test("keeps a sent release waiting until receipt is confirmed", () => {
  const result = applyResult(initialCase(), {
    partyReached: true, caseLocated: true, blocker: "release_sent_not_received", responsibleParty: "Auction",
    referenceNumber: "LR-4721", needsHuman: false, unknownQuestions: [], evidence: "Release sent.",
  });
  assert.equal(result.state, "WAITING_EXTERNAL");
  assert.equal(result.referenceNumber, "LR-4721");
});

test("stops when a recipient asks an unknown or prohibited question", () => {
  const result = applyResult(initialCase(), {
    partyReached: true, caseLocated: true, blocker: "unknown", responsibleParty: null,
    referenceNumber: null, needsHuman: true, unknownQuestions: ["Provide portal security code"], evidence: "Agent declined credential request.",
  });
  assert.equal(result.state, "NEEDS_HUMAN");
});
