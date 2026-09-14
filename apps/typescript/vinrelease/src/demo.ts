import { applyResult, initialCase } from "./workflow.js";

const afterAuction = applyResult(initialCase(), {
  partyReached: true, caseLocated: true, blocker: "lien_release_missing", responsibleParty: "ABC Bank",
  referenceNumber: null, needsHuman: false, unknownQuestions: [], evidence: "Auction confirmed ABC Bank's lien release is missing.",
});
console.log(`${afterAuction.state} | ${afterAuction.blocker} | next ${afterAuction.nextOwner}`);

const afterLienholder = applyResult(afterAuction, {
  partyReached: true, caseLocated: true, blocker: "release_sent_not_received", responsibleParty: "Metro Auto Auction",
  referenceNumber: "LR-4721", needsHuman: false, unknownQuestions: [], evidence: "Lienholder says the release was sent; receipt remains unconfirmed.",
});
console.log(`${afterLienholder.state} | ${afterLienholder.blocker} | ref ${afterLienholder.referenceNumber}`);
